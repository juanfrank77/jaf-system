import {
	computeContractorPayment,
	payeeCode,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { toNumberPrice } from "~/lib/utils"
import { Prisma } from "../../generated/prisma/client"

const INVOICE_SELECT = {
	id: true,
	controlNumber: true,
	avisoNumber: true,
	contractorShareLines: true,
	contractorAccount: {
		select: {
			id: true,
			code: true,
			label: true,
		},
	},
} as const

/**
 * A run's invoices, in the ONE order the journal is ever rendered in.
 *
 * `buildJournalBlocks` sorts blocks by brigade code and jobs by controlNumber
 * internally, so the DB row order only needs to be deterministic. We order by
 * `releasedToFinanceAt` (batch release) with `id` as a tiebreaker so the same
 * set of invoices renders identically on every page load — the running
 * totals in the PDF are derived from this set, so a shifting order would
 * produce a different journal between the screen and a PDF printed from it.
 *
 * Shared by every loader and PDF branch (finance and comptroller) on purpose —
 * the printed journal has to agree with the screen, and a duplicated literal
 * is how they drift.
 */
export const RUN_INVOICES = {
	select: INVOICE_SELECT,
	orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
} as const satisfies Prisma.PayrollRun$invoicesArgs

/** Today's calendar date (YYYY-MM-DD) in Puerto Rico, whatever the server TZ. */
export function puertoRicoToday(): string {
	return new Date().toLocaleDateString("en-CA", {
		timeZone: "America/Puerto_Rico",
	})
}

/**
 * Validates the `paidDate` form field shared by the whole-run and per-account
 * confirms. `<input type="date">` posts YYYY-MM-DD; `new Date("YYYY-MM-DD")`
 * is UTC midnight, which renders as the previous day in Puerto Rico (UTC-4),
 * so the date is anchored at local noon instead.
 */
export function parsePaidDate(raw: string | null | undefined):
	| { date: Date }
	| {
			errorKey:
				| "finance_payroll.errors.missing_fields"
				| "finance_payroll.errors.invalid_date"
				| "finance_payroll.errors.future_date"
	  } {
	const value = raw?.trim()
	if (!value) return { errorKey: "finance_payroll.errors.missing_fields" }
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return { errorKey: "finance_payroll.errors.invalid_date" }
	}
	const date = new Date(`${value}T12:00:00`)
	if (Number.isNaN(date.getTime())) {
		return { errorKey: "finance_payroll.errors.invalid_date" }
	}
	// Compare calendar days (YYYY-MM-DD sorts lexically), not instants: "today"
	// is valid at any hour. Today is the Puerto Rico calendar day.
	if (value > puertoRicoToday()) {
		return { errorKey: "finance_payroll.errors.future_date" }
	}
	return { date }
}

/**
 * Every job currently open on Arm A — the L1 query and the sweep source.
 *
 * Deliberately does NOT filter on `contractorAccountId` — that field is only
 * ever set by `generateRun` itself, resolved from `contractorAccountCode` at
 * sweep time (see below). Filtering on it here would mean no job could ever
 * appear in L1 in the first place. A job with an unmapped
 * `contractorAccountCode` still matches this query and still appears on
 * L1 — `generateRun` skips it (leaving it open) rather than this query
 * hiding it.
 *
 * `packetView` exists for one caller: the L2 packet, whose window is
 * deliberately WIDER than L1's. It has to keep serving a job that was already
 * swept into an open, unpaid run, so finance can read the frozen figures off
 * it, and it has to keep serving a job that already has its LC request
 * generated — both are past the point where L1 would list them, but finance
 * still opens them. So `packetView` drops the `LC_REQUEST_GENERATED`
 * exclusion and the `payrollRunId: null` clause.
 *
 * What it deliberately does NOT drop: the `CANCELLED` exclusion, "was released
 * to finance", and "is not already closed". Those are the clauses that say
 * whether the job is on Arm A at all, so every future tightening of them
 * reaches the packet view without having to be applied a second time. The
 * CANCELLED guard in particular used to reach this loader through
 * `computeFinanceStage` and was lost when that gate was replaced by an inline
 * restatement of the predicate.
 *
 * All of this lives here so the relaxation reads as a decision rather than an
 * accident, and there is exactly one definition of "on Arm A".
 */
export function armAOpenWhere(
	opts: { packetView?: boolean } = {},
): Prisma.JafInvoiceWhereInput {
	return {
		// Terminal statuses must be excluded here, in the one shared predicate.
		// Cancellation is only blocked once a doc is ALREADY terminal
		// (`docs.$id.tsx` checks `isTerminalStatus` before cancelling), and the
		// cancel transaction never clears `releasedToFinanceAt` — so a doc
		// cancelled after release keeps a non-null `releasedToFinanceAt` and
		// would otherwise satisfy every other clause here, get its amounts
		// frozen, and be batch-confirmed as paid. This also restores the guard
		// the old L1 query carried (`status: { notIn: [...] }`).
		//
		// `LC_REQUEST_GENERATED` is excluded from the L1/sweep view only: a job
		// whose credit-line request is already out is not pending Arm A payment.
		// The packet view keeps serving it (see `packetView` above).
		status: {
			notIn: opts.packetView
				? ["CANCELLED"]
				: ["LC_REQUEST_GENERATED", "CANCELLED"],
		},
		releasedToFinanceAt: { not: null },
		payablesClosedAt: null,
		// "Not yet claimed" — what makes a job sweepable exactly once. Dropped
		// in the packet view so finance can still open a job that has already
		// been swept. Funding (a PBCC_ADVANCE payment record) is
		// deliberately NOT a clause here, so the packets list stays funding-agnostic;
		// `sweepableWhere` adds the funded requirement for payroll runs.
		...(opts.packetView ? {} : { payrollRunId: null }),
	}
}

/**
 * What a payroll request may sweep: everything open on Arm A that is Sold to
 * PBCC (its batch was marked sent). Payroll is paid on schedule whether or not
 * the bank has wired yet, so funding is not a condition. `armAOpenWhere` itself
 * is unchanged, so the packets list and packet view keep showing unsent jobs.
 * Nothing here filters on `active`: an inactive brigade is still paid for jobs
 * already finished.
 */
function sweepableWhere(): Prisma.JafInvoiceWhereInput {
	return {
		...armAOpenWhere(),
		pbccRequestSentAt: { not: null },
	}
}

/**
 * Sold-but-blocked: the packet is sold to PBCC and open on Arm A, but its
 * brigade code is missing or does not resolve to a contractor account, so a
 * run would skip it. Shown on the payroll screen so Lissette
 * can fix the mapping.
 */
export async function blockedSentJobs() {
	const docs = await db.jafInvoice.findMany({
		where: sweepableWhere(),
		select: {
			id: true,
			controlNumber: true,
			contractorAccountCode: true,
			brigade: { select: { code: true, name: true } },
			preCertSheets: {
				orderBy: { version: "desc" },
				take: 1,
				select: { sigSubcontractorName: true },
			},
		},
		orderBy: { controlNumber: "asc" },
	})
	const resolved = await resolveContractorAccounts(docs.map(payeeCode))
	return docs.filter((d) => {
		const code = payeeCode(d)
		return !code || !resolved.has(code)
	})
}

/** Thrown (before anything is written) when a run would contain no jobs. */
export class EmptyRunError extends Error {
	constructor() {
		super("No sweepable jobs for this payroll run")
		this.name = "EmptyRunError"
	}
}

/**
 * Sweep the open Arm A jobs into one payroll request, as a draft.
 *
 * Default is "everything ready" (q&a 15.4); `excludeIds` is the jobs Lissette
 * unticked to hold back from this request. They stay open and visible. The
 * request is Lissette's alone until `sendPayrollRun` hands it to Carmen.
 * Throws `EmptyRunError`, writing nothing, when no job would be swept: a
 * request with no jobs can never exist, and a brigade only appears on it
 * through a job.
 */
export async function generateRun(opts: {
	generatedById: string
	label: string
	excludeIds?: ReadonlyArray<string>
}): Promise<{ run: { id: string; label: string }; sweptCount: number }> {
	const excludeIds = opts.excludeIds ?? []
	const candidates = await db.jafInvoice.findMany({
		where: {
			...sweepableWhere(),
			...(excludeIds.length ? { id: { notIn: [...excludeIds] } } : {}),
		},
		select: {
			id: true,
			jafInvoiceLines: true,
			contractorAccountCode: true,
			brigade: { select: { code: true } },
		},
	})

	// Resolve accounts before opening the transaction — a job whose code
	// doesn't resolve to any seeded ContractorAccount is left out of
	// `toSweep` entirely (stays open, stays visible on L1, per Review Focus).
	// One query for the whole batch, not one per candidate: the candidate set
	// is unbounded (see the deploy guide's §7 note), so this loop is the
	// widest in the feature.
	const resolved = await resolveContractorAccounts(candidates.map(payeeCode))
	const toSweep: Array<{
		id: string
		payment: ReturnType<typeof computeContractorPayment>
		accountId: string
	}> = []
	for (const doc of candidates) {
		const code = payeeCode(doc)
		const account = code ? resolved.get(code) : undefined
		if (!account) continue
		toSweep.push({
			id: doc.id,
			// Computed here, outside the transaction, so the transaction only
			// holds the writes.
			payment: computeContractorPayment(
				toContractorPaymentLines(doc.jafInvoiceLines),
			),
			accountId: account.id,
		})
	}
	if (toSweep.length === 0) throw new EmptyRunError()

	// Each row's write is its own conditional update (`updateMany` +
	// `payrollRunId: null` in the WHERE, not a plain `update`), not a single
	// blanket write per candidate — this is what makes the claim race-safe.
	// If two "Generate run" calls overlap and both read the same candidate
	// before either commits, Postgres serializes their UPDATEs on that row
	// (row-level lock, Read Committed re-checks the WHERE on wake): whichever
	// commits first claims the row; the second's `updateMany` then matches
	// zero rows for it and simply doesn't count it.
	const run = await db.$transaction(
		async (tx) => {
			const created = await tx.payrollRun.create({
				data: { label: opts.label, generatedById: opts.generatedById },
			})
			let swept = 0
			const claimedAccountIds = new Set<string>()
			for (const doc of toSweep) {
				const { payment } = doc
				const result = await tx.jafInvoice.updateMany({
					where: { id: doc.id, payrollRunId: null },
					data: {
						payrollRunId: created.id,
						contractorAccountId: doc.accountId,
						contractorShareLines: payment.contractorShareLines as never,
						grossPayable: payment.grossPayable,
						retentionAmount: payment.retentionAmount,
						netPayable: payment.netPayable,
					},
				})
				if (result.count > 0) claimedAccountIds.add(doc.accountId)
				swept += result.count
			}
			// Every candidate was claimed by a concurrent run: roll back rather than
			// leave an empty run that could be marked paid.
			if (swept === 0) throw new EmptyRunError()
			await tx.payrollRunAccount.createMany({
				data: [...claimedAccountIds].map((contractorAccountId) => ({
					payrollRunId: created.id,
					contractorAccountId,
				})),
			})
			return { created, swept }
			// The first run sweeps the whole released backlog (one write per job), so
			// the 5s interactive-transaction default is not enough.
		},
		{ timeout: 120_000, maxWait: 10_000 },
	)

	return { run: run.created, sweptCount: run.swept }
}

/**
 * Hand a draft request to Carmen: stamps it sent and tells the comptrollers.
 * Sending is once only; a request already sent is left as it was (409).
 */
export async function sendPayrollRun(opts: {
	runId: string
	sentById: string
}): Promise<void> {
	await db.$transaction(async (tx) => {
		const run = await tx.payrollRun.findUnique({
			where: { id: opts.runId },
			select: { label: true, sentAt: true, reversedAt: true },
		})
		if (!run) throw new Response("Not Found", { status: 404 })
		if (run.sentAt || run.reversedAt) {
			throw new Response("Payroll request is already sent", { status: 409 })
		}
		// The jobs are the request: never send one that has none.
		const jobs = await tx.jafInvoice.count({
			where: { payrollRunId: opts.runId },
		})
		if (jobs === 0) throw new EmptyRunError()
		const claimed = await tx.payrollRun.updateMany({
			where: { id: opts.runId, sentAt: null },
			data: { sentAt: new Date(), sentById: opts.sentById },
		})
		if (claimed.count === 0) {
			throw new Response("Payroll request is already sent", { status: 409 })
		}
		const comptrollers = await tx.user.findMany({
			where: { role: "COMPTROLLER", active: true },
			select: { id: true },
		})
		if (comptrollers.length > 0) {
			await tx.notification.createMany({
				data: comptrollers.map((u) => ({
					userId: u.id,
					message: `Payroll request ${run.label} is ready to pay — ${jobs} Avisos.`,
				})),
			})
		}
	})
}

/**
 * Put a draft request's jobs back on the Ready tab. Only a request Carmen has
 * not been given yet can go: once sent it stays, and a mistake is fixed with
 * her, not by deleting it.
 */
export async function discardDraftRun(runId: string): Promise<void> {
	await db.$transaction(async (tx) => {
		const run = await tx.payrollRun.findUnique({
			where: { id: runId },
			select: { sentAt: true },
		})
		if (!run) throw new Response("Not Found", { status: 404 })
		if (run.sentAt) {
			throw new Response("Payroll request is already sent", { status: 409 })
		}
		await tx.jafInvoice.updateMany({
			where: { payrollRunId: runId },
			data: {
				payrollRunId: null,
				contractorAccountId: null,
				contractorShareLines: Prisma.DbNull,
				grossPayable: null,
				retentionAmount: null,
				netPayable: null,
			},
		})
		await tx.payrollRunAccount.deleteMany({ where: { payrollRunId: runId } })
		await tx.payrollRun.delete({ where: { id: runId } })
	})
}

/**
 * Tick one brigade of a payroll request as paid. Only Carmen does this: there
 * is no way to confirm on her behalf. Stamps the account row and
 * `payablesClosedAt`/`payablesClosedById` on that brigade's jobs in the
 * request (which closes Arm A for them and removes them from Arm A's lists).
 * When it was the last unpaid brigade the request itself is closed and FINANCE
 * is notified, exactly once even under concurrent last ticks. No ACH reference
 * is kept (q&a 15.2).
 *
 * Throws 404 if the brigade is not part of the request, 409 if it is already
 * paid or the request has not been sent to Carmen yet.
 * `reversedAt` / `reversedById` / `reverseReason` on PayrollRun are the schema
 * hook for the admin-only reversal planned for Phase 5 (q&a 15.5).
 */
export async function closePayrollRunAccount(opts: {
	runId: string
	accountId: string
	paidById: string
	paidDate: Date
}): Promise<{ runClosed: boolean }> {
	return db.$transaction(async (tx) => {
		const exists = await tx.payrollRunAccount.findUnique({
			where: {
				payrollRunId_contractorAccountId: {
					payrollRunId: opts.runId,
					contractorAccountId: opts.accountId,
				},
			},
			select: { id: true },
		})
		if (!exists) throw new Response("Account not in this run", { status: 404 })
		// Lock the run row first: a reversed or already-closed run must refuse
		// before the account is claimed, and the later "was that the last
		// one?" decision is serialized on the same lock.
		await tx.$queryRaw`SELECT "id" FROM "PayrollRun" WHERE "id" = ${opts.runId} FOR UPDATE`
		const runState = await tx.payrollRun.findUniqueOrThrow({
			where: { id: opts.runId },
			select: { reversedAt: true, paidAt: true, sentAt: true },
		})
		if (runState.reversedAt || runState.paidAt) {
			throw new Response("Run is reversed or already paid", { status: 409 })
		}
		// A draft is still Lissette's to review: nobody pays against it.
		if (!runState.sentAt) {
			throw new Response("Request has not been sent to Carmen", {
				status: 409,
			})
		}
		// Conditional claim: same double-submit guard as the old whole-run close.
		const claimed = await tx.payrollRunAccount.updateMany({
			where: {
				payrollRunId: opts.runId,
				contractorAccountId: opts.accountId,
				paidAt: null,
			},
			data: { paidAt: opts.paidDate, paidById: opts.paidById },
		})
		if (claimed.count === 0) {
			throw new Response("Account already paid", { status: 409 })
		}
		await tx.jafInvoice.updateMany({
			where: { payrollRunId: opts.runId, contractorAccountId: opts.accountId },
			data: {
				// When the system closed the job, not the user-typed pay date.
				payablesClosedAt: new Date(),
				payablesClosedById: opts.paidById,
			},
		})
		// The run row is already locked (above), so two concurrent last ticks
		// cannot both see "someone else is still unpaid" (nobody closes) or
		// both see "none left" (double notify).
		const remaining = await tx.payrollRunAccount.count({
			where: { payrollRunId: opts.runId, paidAt: null },
		})
		if (remaining > 0) return { runClosed: false }
		const closed = await tx.payrollRun.updateMany({
			where: { id: opts.runId, paidAt: null, reversedAt: null },
			data: { paidAt: opts.paidDate, paidById: opts.paidById },
		})
		if (closed.count === 0) return { runClosed: false }
		const [{ label }, count, financeUsers] = await Promise.all([
			tx.payrollRun.findUniqueOrThrow({
				where: { id: opts.runId },
				select: { label: true },
			}),
			tx.jafInvoice.count({ where: { payrollRunId: opts.runId } }),
			tx.user.findMany({
				where: { role: "FINANCE", active: true },
				select: { id: true },
			}),
		])
		if (financeUsers.length > 0) {
			await tx.notification.createMany({
				data: financeUsers.map((u) => ({
					userId: u.id,
					message: `Request ${label} paid — ${count} Avisos payroll confirmed.`,
				})),
			})
		}
		return { runClosed: true }
	})
}

type JournalLine = {
	claroCode: string
	description: string
	qty: number
	unitPrice: number
	gross: number
	net: number
	pctRet: number
	retention: number
	adjNet: number
}

type JournalJob = {
	invoiceId: string
	controlNumber: string
	avisoNumber: string | null
	lines: JournalLine[]
	gross: number
	net: number
	retention: number
	adjNet: number
	/** Running adj. net after this job, within the same brigade. */
	adjNetRunning: number
}

type JournalBlock = {
	brigadeCode: string
	brigadeLabel: string
	gross: number
	net: number
	retention: number
	/** Final running adj. net for this brigade (= Total SC line). */
	totalSC: number
	jobs: JournalJob[]
}

/**
 * Group a run's invoices into one block per brigade (via its contractor
 * account), with per-job sub-totals and per-line detail — the structure the
 * paper Production Journal carries: brigade → job → service line.
 *
 * Rules from docs/JAF_Finance_answer_Journey.pdf Part 1 § "How the report is built":
 *  - Columns: ASSOC/code · DESCRIPTION · QTY · UNIT PRICE · GROSS · NET ·
 *    Pct. RET. (always 0.00) · 10% RET. · ADJ. NET
 *  - Net = Gross × 0.65; Retention = Net × 0.10; Adj. Net = Gross × 0.585
 *    (all truncated to cents per line — see computeContractorPayment)
 *  - Sub Total: Gross, Net, Ret summed per job; Adj. Net = running total
 *    within the brigade
 *  - Total SC: ends each brigade; running restarts at the next brigade
 *  - Order: brigades by number, jobs by M-number (controlNumber) inside
 *
 * Pure: it reads the already-frozen per-invoice amounts and the
 * `contractorShareLines` snapshot, so a later catalog price change can never
 * move a generated run's journal.
 */
export function buildJournalBlocks(
	invoices: Array<{
		id: string
		controlNumber: string
		avisoNumber: string | null
		contractorAccount: {
			id: string
			code: string
			label: string
		} | null
		contractorShareLines: unknown
	}>,
): JournalBlock[] {
	const byBrigade = new Map<string, JournalBlock>()
	for (const doc of invoices) {
		if (!doc.contractorAccount) continue
		const acc = doc.contractorAccount
		let block = byBrigade.get(acc.code)
		if (!block) {
			block = {
				brigadeCode: acc.code,
				brigadeLabel: acc.label,
				gross: 0,
				net: 0,
				retention: 0,
				totalSC: 0,
				jobs: [],
			}
			byBrigade.set(acc.code, block)
		}

		const lines: JournalLine[] = parseShareLines(doc.contractorShareLines)
		const gross = lines.reduce((s, l) => s + l.gross, 0)
		const net = lines.reduce((s, l) => s + l.net, 0)
		const retention = lines.reduce((s, l) => s + l.retention, 0)
		const adjNet = lines.reduce((s, l) => s + l.adjNet, 0)

		block.gross += gross
		block.net += net
		block.retention += retention

		block.jobs.push({
			invoiceId: doc.id,
			controlNumber: doc.controlNumber,
			avisoNumber: doc.avisoNumber,
			lines,
			gross,
			net,
			retention,
			adjNet,
			adjNetRunning: 0,
		})
	}

	const blocks = [...byBrigade.values()].sort((a, b) =>
		a.brigadeCode.localeCompare(b.brigadeCode),
	)
	for (const block of blocks) {
		block.jobs.sort((a, b) => a.controlNumber.localeCompare(b.controlNumber))
		// Running adj. net restarts at each brigade (PDF Part 1 § "Brigade total").
		let running = 0
		for (const job of block.jobs) {
			running += job.adjNet
			job.adjNetRunning = running
		}
		block.totalSC = running
	}
	return blocks
}

const PCT_RET_DEFAULT = 0

function parseShareLines(value: unknown): JournalLine[] {
	if (!Array.isArray(value)) return []
	return value.map((raw) => {
		const line = (raw ?? {}) as Record<string, unknown>
		return {
			claroCode: String(line.claroCode ?? ""),
			description: String(line.name ?? ""),
			qty: toNumberPrice(line.qty),
			unitPrice: toNumberPrice(line.unitPrice),
			gross: toNumberPrice(line.gross),
			net: toNumberPrice(line.net),
			pctRet:
				toNumberPrice(line.pctRet ?? line.pctRetention ?? 0) || PCT_RET_DEFAULT,
			retention: toNumberPrice(line.retention),
			adjNet: toNumberPrice(line.adjNet),
		}
	})
}

/** One line of the payroll request sheet: a brigade, the Avisos it covers, what it is paid. */
export type PayrollSheetLine = {
	brigadeCode: string
	brigadeLabel: string
	avisoNumbers: string[]
	/** 65% of the pre-IVU labor. */
	net: number
	/** 10% of net, held back. */
	retention: number
	/** Net less retention: the amount Carmen pays. */
	toPay: number
}

/**
 * The request as Carmen and Lissette read it. Gross is the JAF price and is
 * deliberately not carried: this is the only shape of a request that leaves
 * Lissette's desk, so nothing downstream can print what it does not have.
 */
export function payrollSheetLines(blocks: JournalBlock[]): PayrollSheetLine[] {
	return blocks.map((b) => ({
		brigadeCode: b.brigadeCode,
		brigadeLabel: b.brigadeLabel,
		avisoNumbers: [
			...new Set(
				b.jobs.map((j) => j.avisoNumber).filter((n): n is string => !!n),
			),
		].sort(),
		net: b.net,
		retention: b.retention,
		toPay: b.totalSC,
	}))
}
