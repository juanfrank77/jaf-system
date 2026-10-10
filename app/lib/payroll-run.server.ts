import {
	computeContractorPayment,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { isPayrollFallbackEnabled } from "~/lib/features.server"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"

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
 * exclusion, the `payrollRunId: null` clause and the PBCC_ADVANCE absence.
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
		// been swept or that carries a legacy PBCC advance.
		...(opts.packetView
			? {}
			: {
					payrollRunId: null,
					paymentRecords: { none: { type: "PBCC_ADVANCE" } },
				}),
	}
}

/**
 * What a payroll run may sweep: everything open on Arm A whose bank request
 * has been sent to PBCC (spec §3). Funding is NOT part of the gate: JAF's rule
 * so far is "complete and sent before the brigade is paid"; whether pay is held
 * until PBCC funds is unconfirmed. To gate on funding later, add
 * `advanceReceivedAt: { not: null }` here. `armAOpenWhere` itself is unchanged,
 * so the packets list and packet view keep showing unsent jobs. Nothing here
 * filters on `active`: an inactive brigade is still paid.
 */
export function sweepableWhere(): Prisma.JafInvoiceWhereInput {
	return { ...armAOpenWhere(), pbccRequestSentAt: { not: null } }
}

/** Info only (finance screens): how many sweepable packets are already funded. */
export async function countFundedSweepableJobs(): Promise<number> {
	const docs = await db.jafInvoice.findMany({
		where: { ...sweepableWhere(), advanceReceivedAt: { not: null } },
		select: { contractorAccountCode: true },
	})
	const resolved = await resolveContractorAccounts(
		docs.map((d) => d.contractorAccountCode),
	)
	return docs.filter(
		(d) => d.contractorAccountCode && resolved.has(d.contractorAccountCode),
	).length
}

/** Thrown (before anything is written) when a run would contain no jobs. */
export class EmptyRunError extends Error {
	constructor() {
		super("No sweepable jobs for this payroll run")
		this.name = "EmptyRunError"
	}
}

/**
 * Open jobs a run could actually sweep: on Arm A and mapped to a contractor
 * account. A job with an unmapped code stays open and visible on L1 (with a
 * badge) but sweeps to nothing, so it must not inflate the "Generate run (N)"
 * count. Uses the same predicate and the same resolver as `generateRun`.
 */
export async function countSweepableJobs(
	excludeIds: ReadonlyArray<string> = [],
): Promise<number> {
	const docs = await db.jafInvoice.findMany({
		where: {
			...sweepableWhere(),
			...(excludeIds.length ? { id: { notIn: [...excludeIds] } } : {}),
		},
		select: { contractorAccountCode: true },
	})
	const resolved = await resolveContractorAccounts(
		docs.map((d) => d.contractorAccountCode),
	)
	return docs.filter(
		(d) => d.contractorAccountCode && resolved.has(d.contractorAccountCode),
	).length
}

/**
 * Sweep the open Arm A jobs into one payroll run.
 *
 * Default is "everything ready" (q&a 15.4); `excludeIds` is the jobs Lissette
 * unticked on L1 to hold back from this report. They stay open and visible.
 * Throws `EmptyRunError`, writing nothing, when no job would be swept.
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
		select: { id: true, jafInvoiceLines: true, contractorAccountCode: true },
	})

	// Resolve accounts before opening the transaction — a job whose code
	// doesn't resolve to any seeded ContractorAccount is left out of
	// `toSweep` entirely (stays open, stays visible on L1, per Review Focus).
	// One query for the whole batch, not one per candidate: the candidate set
	// is unbounded (see the deploy guide's §7 note), so this loop is the
	// widest in the feature.
	const resolved = await resolveContractorAccounts(
		candidates.map((c) => c.contractorAccountCode),
	)
	const toSweep: Array<{
		id: string
		payment: ReturnType<typeof computeContractorPayment>
		accountId: string
	}> = []
	for (const doc of candidates) {
		if (!doc.contractorAccountCode) continue
		const account = resolved.get(doc.contractorAccountCode)
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
			const comptrollers = await tx.user.findMany({
				where: { role: "COMPTROLLER", active: true },
				select: { id: true },
			})
			if (comptrollers.length > 0) {
				await tx.notification.createMany({
					data: comptrollers.map((u) => ({
						userId: u.id,
						message: `Production Journal ${opts.label} is ready to pay — ${claimedAccountIds.size} accounts.`,
					})),
				})
			}
			return { created, swept }
			// The first run sweeps the whole released backlog (one write per job), so
			// the 5s interactive-transaction default is not enough.
		},
		{ timeout: 120_000, maxWait: 10_000 },
	)

	return { run: run.created, sweptCount: run.swept }
}

/**
 * Tick one contractor account of a payroll run as paid (Carmen's per-account
 * PAID, or finance's paper fallback): stamps the account row and
 * `payablesClosedAt`/`payablesClosedById` on that account's jobs in the run
 * (which removes them from Arm A and therefore from L1). When it was the last
 * unpaid account the run itself is closed and FINANCE is notified, exactly
 * once even under concurrent last ticks. No ACH reference is kept (q&a 15.2).
 *
 * Throws 403 for a fallback tick when PAYROLL_FALLBACK_ENABLED is off, 404 if
 * the account is not part of the run, 409 if it is already paid.
 * `reversedAt` / `reversedById` / `reverseReason` on PayrollRun are the schema
 * hook for the admin-only reversal planned for Phase 5 (q&a 15.5).
 */
export async function closePayrollRunAccount(opts: {
	runId: string
	accountId: string
	paidById: string
	paidDate: Date
	confirmedByFallback: boolean
}): Promise<{ runClosed: boolean }> {
	// Finance confirming from paper is a side-by-side-period fallback; once
	// switched off at go-live only the comptroller ticks.
	if (opts.confirmedByFallback && !isPayrollFallbackEnabled()) {
		throw new Response("Fallback confirmation is switched off", { status: 403 })
	}
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
		// Conditional claim: same double-submit guard as the old whole-run close.
		const claimed = await tx.payrollRunAccount.updateMany({
			where: {
				payrollRunId: opts.runId,
				contractorAccountId: opts.accountId,
				paidAt: null,
			},
			data: {
				paidAt: opts.paidDate,
				paidById: opts.paidById,
				confirmedByFallback: opts.confirmedByFallback,
			},
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
		// Serialize the "was that the last one?" decision on the run row so two
		// concurrent last ticks cannot both see "someone else is still unpaid"
		// (nobody closes) or both see "none left" (double notify).
		await tx.$queryRaw`SELECT "id" FROM "PayrollRun" WHERE "id" = ${opts.runId} FOR UPDATE`
		const remaining = await tx.payrollRunAccount.count({
			where: { payrollRunId: opts.runId, paidAt: null },
		})
		if (remaining > 0) return { runClosed: false }
		// The run is "confirmed by fallback" if ANY of its accounts was, not just the last tick.
		const anyFallback =
			(await tx.payrollRunAccount.count({
				where: { payrollRunId: opts.runId, confirmedByFallback: true },
			})) > 0
		const closed = await tx.payrollRun.updateMany({
			where: { id: opts.runId, paidAt: null, reversedAt: null },
			data: {
				paidAt: opts.paidDate,
				paidById: opts.paidById,
				confirmedByFallback: anyFallback,
			},
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
					message: `Run ${label} paid — ${count} Avisos payroll confirmed.`,
				})),
			})
		}
		return { runClosed: true }
	})
}

/**
 * Whole-run confirm (finance's paper fallback): ticks every still-unpaid
 * account of the run through `closePayrollRunAccount`, so the last tick closes
 * the run and notifies FINANCE. Returns the number of member invoices closed.
 *
 * Throws 403 if `confirmedByFallback` and the fallback switch is off, 404 for
 * an unknown run, 409 if the run is already closed.
 */
export async function closePayrollRun(opts: {
	runId: string
	paidById: string
	/** The date the run was paid; stamped on `PayrollRun.paidAt`. */
	paidDate: Date
	evidencePath?: string | null
	confirmedByFallback: boolean
}): Promise<{ closedCount: number }> {
	if (opts.confirmedByFallback && !isPayrollFallbackEnabled()) {
		throw new Response("Fallback confirmation is switched off", { status: 403 })
	}
	const run = await db.payrollRun.findUnique({
		where: { id: opts.runId },
		select: { paidAt: true, reversedAt: true },
	})
	if (!run) throw new Response("Not Found", { status: 404 })
	if (run.paidAt || run.reversedAt) {
		throw new Response("Payroll run is already closed", { status: 409 })
	}
	if (opts.evidencePath) {
		await db.payrollRun.update({
			where: { id: opts.runId },
			data: { evidencePath: opts.evidencePath },
		})
	}
	const open = await db.payrollRunAccount.findMany({
		where: { payrollRunId: opts.runId, paidAt: null },
		select: { contractorAccountId: true },
	})
	for (const { contractorAccountId } of open) {
		try {
			await closePayrollRunAccount({
				runId: opts.runId,
				accountId: contractorAccountId,
				paidById: opts.paidById,
				paidDate: opts.paidDate,
				confirmedByFallback: opts.confirmedByFallback,
			})
		} catch (e) {
			// Lost a race with another tick of the same account: fine, skip it.
			if (!(e instanceof Response && e.status === 409)) throw e
		}
	}
	const closedCount = await db.jafInvoice.count({
		where: { payrollRunId: opts.runId, payablesClosedAt: { not: null } },
	})
	return { closedCount }
}

export type JournalLine = {
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

export type JournalJob = {
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

export type JournalBlock = {
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
