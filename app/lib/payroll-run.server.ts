import {
	type ContractorPayment,
	type ContractorPaymentLine,
	computeContractorPayment,
	crewsWithWork,
	loadCrewPayees,
	loadLineShares,
	payeeCodesOf,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import {
	BASE_SHARE_PERCENT,
	isDPercent,
	percentOf,
	shareFigures,
} from "~/lib/contractor-share"
import { type CrewLines, lineOwners } from "~/lib/crew-field"
import { db } from "~/lib/db.server"
import {
	displayRequestLabel,
	highestRequestNumber,
	payPeriodLabel,
	requestNumberLabel,
} from "~/lib/payroll-request-view"
import { round2 } from "~/lib/service-lines"
import { toNumberPrice } from "~/lib/utils"
import { Prisma } from "../../generated/prisma/client"

const INVOICE_SELECT = {
	id: true,
	controlNumber: true,
	jobSeq: true,
	avisoNumber: true,
	contractorShareLines: true,
	payablesClosedAt: true,
	contractorAccount: {
		select: {
			id: true,
			code: true,
			label: true,
			// Carmen's Acct # for the brigade, printed as Acct. ID on the journal.
			brigade: { select: { code: true } },
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
/** "PR0004 · 10/19/2026 – 11/01/2026": what a new request is called unless Lissette retitles it. */
export async function defaultRequestLabel(now: Date = new Date()) {
	const labels = await db.payrollRun.findMany({ select: { label: true } })
	const next = highestRequestNumber(labels.map((l) => l.label)) + 1
	return `${requestNumberLabel(next)} · ${payPeriodLabel(now)}`
}

export const puertoRicoDay = (d: Date) =>
	d.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })

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
	// Typed as MM/DD/YYYY, as the whole app writes dates; a picker's YYYY-MM-DD still works.
	const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
	const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : value
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
		return { errorKey: "finance_payroll.errors.invalid_date" }
	}
	const date = new Date(`${iso}T12:00:00`)
	if (Number.isNaN(date.getTime())) {
		return { errorKey: "finance_payroll.errors.invalid_date" }
	}
	// Compare calendar days (YYYY-MM-DD sorts lexically), not instants: "today"
	// is valid at any hour. Today is the Puerto Rico calendar day.
	if (iso > puertoRicoToday()) {
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
			crewServiceLines: true,
			brigade: { select: { code: true, name: true } },
			preCertSheets: {
				orderBy: { version: "desc" },
				take: 1,
				select: { sigSubcontractorName: true },
			},
		},
		orderBy: { controlNumber: "asc" },
	})
	const crews = await loadCrewPayees(docs)
	const resolved = await resolveContractorAccounts(
		docs.flatMap((d) => payeeCodesOf(d, crews)),
	)
	return docs.filter((d) =>
		payeeCodesOf(d, crews).some((code) => !code || !resolved.has(code)),
	)
}

/** The account a share line is paid to, frozen on the line when a job has several crews. */
export type ShareAccount = {
	id: string
	code: string
	label: string
	brigadeCode: string | null
}

/**
 * A job with several crews: each brigade is paid for its own lines, so each gets
 * its own figures, truncated at its own level like any other brigade. A line no
 * card holds (Finance corrected it to the Aviso) goes to the first crew. Every
 * share line names its account; the job's totals are the crews' sums.
 */
export function splitCrewPayment(
	lines: ContractorPaymentLine[],
	crews: (CrewLines & { account: ShareAccount })[],
): ContractorPayment {
	const owners = lineOwners(crews)
	const parts = crews.map((crew, i) =>
		computeContractorPayment(
			lines.filter((l) =>
				owners.has(l.serviceCodeId)
					? owners.get(l.serviceCodeId) === crew.brigadeId
					: i === 0,
			),
		),
	)
	const sum = (pick: (p: ContractorPayment) => number) =>
		Math.round(parts.reduce((s, p) => s + pick(p) * 100, 0)) / 100
	return {
		contractorShareLines: parts.flatMap((p, i) =>
			p.contractorShareLines.map((l) => ({
				...l,
				account: crews[i].account,
			})),
		),
		grossPayable: sum((p) => p.grossPayable),
		retentionAmount: sum((p) => p.retentionAmount),
		netPayable: sum((p) => p.netPayable),
	}
}

/** Every account a swept job pays: one, or one per crew with its share lines. */
export function accountIdsOf(doc: {
	contractorAccountId?: string | null
	contractorAccount?: object | null
	contractorShareLines: unknown
}): string[] {
	const lines = Array.isArray(doc.contractorShareLines)
		? (doc.contractorShareLines as { account?: ShareAccount }[])
		: []
	const ids = [
		...new Set(lines.flatMap((l) => (l?.account ? [l.account.id] : []))),
	]
	if (ids.length > 0) return ids
	const own =
		doc.contractorAccountId ??
		(doc.contractorAccount as { id?: string } | null | undefined)?.id
	return own ? [own] : []
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
			crewServiceLines: true,
			brigade: { select: { code: true } },
		},
	})

	// Resolve accounts before opening the transaction — a job whose code
	// doesn't resolve to any seeded ContractorAccount is left out of
	// `toSweep` entirely (stays open, stays visible on L1, per Review Focus).
	// One query for the whole batch, not one per candidate: the candidate set
	// is unbounded (see the deploy guide's §7 note), so this loop is the
	// widest in the feature.
	const crewPayees = await loadCrewPayees(candidates)
	const resolved = await resolveContractorAccounts(
		candidates.flatMap((c) => payeeCodesOf(c, crewPayees)),
	)
	const shares = await loadLineShares(candidates.map((c) => c.jafInvoiceLines))
	const toSweep: Array<{
		id: string
		payment: ContractorPayment
		accountIds: string[]
	}> = []
	for (const doc of candidates) {
		const accounts = payeeCodesOf(doc, crewPayees).map((code) =>
			code ? resolved.get(code) : undefined,
		)
		// One brigade with no account holds the whole job back: it stays open and
		// visible, and nobody is paid part of a job.
		if (accounts.length === 0 || accounts.some((a) => !a)) continue
		const known = accounts as NonNullable<(typeof accounts)[number]>[]
		const lines = toContractorPaymentLines(doc.jafInvoiceLines, shares)
		toSweep.push({
			id: doc.id,
			// Computed here, outside the transaction, so the transaction only
			// holds the writes.
			payment:
				known.length > 1
					? splitCrewPayment(
							lines,
							crewsWithWork(doc).map((c, i) => ({
								...c,
								account: known[i],
							})),
						)
					: computeContractorPayment(lines),
			accountIds: known.map((a) => a.id),
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
						// The first account; `contractorShareLines` names each crew's.
						contractorAccountId: doc.accountIds[0],
						contractorShareLines: payment.contractorShareLines as never,
						grossPayable: payment.grossPayable,
						retentionAmount: payment.retentionAmount,
						netPayable: payment.netPayable,
					},
				})
				if (result.count > 0)
					for (const id of doc.accountIds) claimedAccountIds.add(id)
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
		// A line on hold is not paid until it is released.
		const held = await tx.payrollRunAccount.count({
			where: {
				payrollRunId: opts.runId,
				contractorAccountId: opts.accountId,
				heldAt: { not: null },
			},
		})
		if (held > 0) throw new Response("Line is on hold", { status: 423 })
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
		// A job closes when every brigade on it is paid.
		const [runDocs, paidLines] = await Promise.all([
			tx.jafInvoice.findMany({
				where: { payrollRunId: opts.runId },
				select: {
					id: true,
					contractorAccountId: true,
					contractorShareLines: true,
				},
			}),
			tx.payrollRunAccount.findMany({
				where: { payrollRunId: opts.runId, paidAt: { not: null } },
				select: { contractorAccountId: true },
			}),
		])
		const paid = new Set(paidLines.map((l) => l.contractorAccountId))
		await tx.jafInvoice.updateMany({
			where: {
				id: {
					in: runDocs
						.filter((d) => {
							const ids = accountIdsOf(d)
							return (
								ids.includes(opts.accountId) && ids.every((id) => paid.has(id))
							)
						})
						.map((d) => d.id),
				},
			},
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

const lineKey = (runId: string, accountId: string) => ({
	payrollRunId_contractorAccountId: {
		payrollRunId: runId,
		contractorAccountId: accountId,
	},
})

async function tellFinance(message: string) {
	const users = await db.user.findMany({
		where: { role: "FINANCE", active: true },
		select: { id: true },
	})
	if (users.length > 0)
		await db.notification.createMany({
			data: users.map((u) => ({ userId: u.id, message })),
		})
}

async function openLine(runId: string, accountId: string) {
	const line = await db.payrollRunAccount.findUnique({
		where: lineKey(runId, accountId),
		select: {
			paidAt: true,
			contractorAccount: { select: { code: true } },
			payrollRun: { select: { label: true, sentAt: true, reversedAt: true } },
		},
	})
	if (!line || !line.payrollRun.sentAt || line.payrollRun.reversedAt)
		throw new Response("Not Found", { status: 404 })
	return line
}

/**
 * Carmen's Hold: the line cannot be ticked paid until she releases it.
 * Lissette sees it in red with the reason and corrects or confirms.
 */
export async function holdPayrollRunAccount(opts: {
	runId: string
	accountId: string
	userId: string
	reason: string
}): Promise<void> {
	const reason = opts.reason.trim()
	if (!reason) throw new Response("A reason is required", { status: 400 })
	const line = await openLine(opts.runId, opts.accountId)
	if (line.paidAt) throw new Response("Already paid", { status: 409 })
	await db.payrollRunAccount.update({
		where: lineKey(opts.runId, opts.accountId),
		data: { heldAt: new Date(), heldById: opts.userId, holdReason: reason },
	})
	await tellFinance(
		`Carmen put ${line.contractorAccount.code} on hold (${displayRequestLabel(line.payrollRun.label)}): ${reason}`,
	)
}

export async function releasePayrollRunAccount(opts: {
	runId: string
	accountId: string
}): Promise<void> {
	await openLine(opts.runId, opts.accountId)
	await db.payrollRunAccount.update({
		where: lineKey(opts.runId, opts.accountId),
		data: { heldAt: null, heldById: null, holdReason: null },
	})
}

/** Carmen's Ask: a note on the line for Lissette. It changes nothing else. */
export async function askAboutPayrollRunAccount(opts: {
	runId: string
	accountId: string
	userId: string
	note: string
}): Promise<void> {
	const note = opts.note.trim()
	if (!note) throw new Response("A note is required", { status: 400 })
	const line = await openLine(opts.runId, opts.accountId)
	await db.payrollRunAccount.update({
		where: lineKey(opts.runId, opts.accountId),
		data: { askNote: note, askAt: new Date(), askById: opts.userId },
	})
	await tellFinance(
		`Carmen asks about ${line.contractorAccount.code} (${displayRequestLabel(line.payrollRun.label)}): ${note}`,
	)
}

/**
 * Undo a Paid tick (rule R6): the same day it was made, with a reason that is
 * logged on each of the brigade's Avisos. The Avisos reopen, and the request
 * reopens if that tick had closed it. The tick's day is when the system
 * stamped it (`payablesClosedAt`), not the pay date Carmen typed.
 */
export async function undoPayrollRunAccount(opts: {
	runId: string
	accountId: string
	userId: string
	reason: string
	now?: Date
}): Promise<void> {
	const reason = opts.reason.trim()
	if (!reason) throw new Response("A reason is required", { status: 400 })
	await db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT "id" FROM "PayrollRun" WHERE "id" = ${opts.runId} FOR UPDATE`
		const run = await tx.payrollRun.findUniqueOrThrow({
			where: { id: opts.runId },
			select: { reversedAt: true },
		})
		if (run.reversedAt) throw new Response("Run is reversed", { status: 409 })
		const account = await tx.payrollRunAccount.findUnique({
			where: {
				payrollRunId_contractorAccountId: {
					payrollRunId: opts.runId,
					contractorAccountId: opts.accountId,
				},
			},
			select: { paidAt: true },
		})
		if (!account) throw new Response("Account not in this run", { status: 404 })
		if (!account.paidAt) throw new Response("Not paid", { status: 409 })
		const invoices = (
			await tx.jafInvoice.findMany({
				where: { payrollRunId: opts.runId },
				select: {
					id: true,
					payablesClosedAt: true,
					contractorAccountId: true,
					contractorShareLines: true,
				},
			})
		).filter((i) => accountIdsOf(i).includes(opts.accountId))
		const today = puertoRicoDay(opts.now ?? new Date())
		// A job with several crews stays open until the last one is paid, so an
		// open one is no reason to refuse; a job closed on another day is.
		if (
			invoices.some(
				(i) =>
					i.payablesClosedAt && puertoRicoDay(i.payablesClosedAt) !== today,
			)
		)
			throw new Response("Only a tick made today can be undone", {
				status: 409,
			})
		await tx.payrollRunAccount.update({
			where: {
				payrollRunId_contractorAccountId: {
					payrollRunId: opts.runId,
					contractorAccountId: opts.accountId,
				},
			},
			data: { paidAt: null, paidById: null },
		})
		await tx.jafInvoice.updateMany({
			where: { id: { in: invoices.map((i) => i.id) } },
			data: { payablesClosedAt: null, payablesClosedById: null },
		})
		await tx.payrollRun.updateMany({
			where: { id: opts.runId, paidAt: { not: null } },
			data: { paidAt: null, paidById: null },
		})
		await tx.auditTrail.createMany({
			data: invoices.map((i) => ({
				docId: i.id,
				userId: opts.userId,
				action: "PAYROLL_PAID_UNDONE",
				diffJson: { reason, source: "STAMPED" },
			})),
		})
	})
}

export type JournalLine = {
	/** Whole percent the line was swept at: 65, or 80 on a D line. */
	percent: number
	claroCode: string
	description: string
	qty: number
	unitPrice: number
	gross: number
	net: number
	pctRet: number
	retention: number
	adjNet: number
	/** The crew's account on a job with several crews. */
	account?: ShareAccount
}

export type JournalJob = {
	invoiceId: string
	controlNumber: string
	/** JAF's M-number, the ASSOC column; null on a job accepted before job numbers. */
	jobSeq: number | null
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
	/** The brigade's account code, "009D" for its D lines. */
	brigadeCode: string
	/** The brigade's real account (no D), what a payment is ticked against. */
	accountCode: string
	brigadeLabel: string
	/** Carmen's Acct # for the brigade (its record's code), null if not set yet. */
	acctId: string | null
	/** 65, or 80 for a D block. */
	percent: number
	/** D-line retention is not confirmed with Lissette yet. */
	unverified: boolean
	gross: number
	net: number
	retention: number
	/** The brigade total: Adj. Net figured on the block's gross. What Carmen pays. */
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
 *  - Net = Gross × 0.65 and Retention = Net-rate × 0.10, each truncated to
 *    the cent from the LINE's gross; Adj. Net = Net − Retention. Round once
 *    per line: every Sub Total, Total SC and grand total only adds the
 *    printed lines, so a column always equals its calculator sum
 *  - Sub Total: Gross, Net, Ret, Adj. Net summed per job; the Adj. Net column
 *    on it is the running total within the brigade
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
		jobSeq?: number | null
		avisoNumber: string | null
		contractorAccount: {
			id: string
			code: string
			label: string
			brigade?: { code: string | null } | null
		} | null
		contractorShareLines: unknown
	}>,
): JournalBlock[] {
	const byBrigade = new Map<string, JournalBlock>()
	for (const doc of invoices) {
		const all: JournalLine[] = parseShareLines(doc.contractorShareLines)
		// Each brigade on the job gets its own block, for its own lines.
		const own = doc.contractorAccount
			? {
					id: doc.contractorAccount.id,
					code: doc.contractorAccount.code,
					label: doc.contractorAccount.label,
					brigadeCode: doc.contractorAccount.brigade?.code ?? null,
				}
			: null
		const accountOf = (l: JournalLine) => l.account ?? own
		for (const acc of new Map(
			all.flatMap((l) => {
				const a = accountOf(l)
				return a ? [[a.id, a] as const] : []
			}),
		).values()) {
			const mine = all.filter((l) => accountOf(l)?.id === acc.id)
			// A D line prints under the brigade's D account ("009D"), at its own rate.
			for (const percent of [...new Set(mine.map((l) => l.percent))]) {
				// Round once, per line: net and retention are truncated from the line's
				// gross, Adj. Net is their difference. Everything above only adds.
				const lines = mine
					.filter((l) => l.percent === percent)
					.map((l) => {
						const f = shareFigures(l.gross, percent)
						return {
							...l,
							net: f.net,
							retention: f.retention,
							adjNet: cents(f.net - f.retention),
						}
					})
				const isD = isDPercent(percent)
				const key = isD ? `${acc.code}D` : acc.code
				let block = byBrigade.get(key)
				if (!block) {
					block = {
						brigadeCode: key,
						accountCode: acc.code,
						brigadeLabel: acc.label,
						acctId: acc.brigadeCode,
						percent,
						unverified: isD,
						gross: 0,
						net: 0,
						retention: 0,
						totalSC: 0,
						jobs: [],
					}
					byBrigade.set(key, block)
				}
				const gross = round2(lines.reduce((s, l) => s + l.gross, 0))
				block.gross = round2(block.gross + gross)
				block.jobs.push({
					invoiceId: doc.id,
					controlNumber: doc.controlNumber,
					jobSeq: doc.jobSeq ?? null,
					avisoNumber: doc.avisoNumber,
					lines,
					gross,
					net: sumCents(lines, (l) => l.net),
					retention: sumCents(lines, (l) => l.retention),
					adjNet: sumCents(lines, (l) => l.adjNet),
					adjNetRunning: 0,
				})
			}
		}
	}

	const blocks = [...byBrigade.values()].sort((a, b) =>
		a.brigadeCode.localeCompare(b.brigadeCode),
	)
	for (const block of blocks) {
		// Ascending job #; a job with no M-number yet sorts after, by work order.
		block.jobs.sort(
			(a, b) =>
				(a.jobSeq ?? Number.MAX_SAFE_INTEGER) -
					(b.jobSeq ?? Number.MAX_SAFE_INTEGER) ||
				a.controlNumber.localeCompare(b.controlNumber),
		)
		// Running adj. net restarts at each brigade and is a plain running sum of
		// the jobs above it, so the last one is the brigade's Total SC.
		let running = 0
		for (const job of block.jobs) {
			running = cents(running + job.adjNet)
			job.adjNetRunning = running
		}
		block.net = sumCents(block.jobs, (j) => j.net)
		block.retention = sumCents(block.jobs, (j) => j.retention)
		block.totalSC = running
	}
	return blocks
}

const PCT_RET_DEFAULT = 0

/** A money figure rounded to whole cents, so sums of cents never drift. */
const cents = (n: number) => Math.round(n * 100) / 100
const sumCents = <T>(items: T[], pick: (item: T) => number) =>
	items.reduce((s, i) => s + Math.round(pick(i) * 100), 0) / 100

function parseShareLines(value: unknown): JournalLine[] {
	if (!Array.isArray(value)) return []
	return value.map((raw) => {
		const line = (raw ?? {}) as Record<string, unknown>
		return {
			percent: percentOf(
				line.sharePercent == null
					? BASE_SHARE_PERCENT / 100
					: toNumberPrice(line.sharePercent),
			),
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
			...(line.account ? { account: line.account as ShareAccount } : {}),
		}
	})
}

/** One line of the payroll request sheet: a brigade, the Avisos it covers, what it is paid. */
export type PayrollSheetLine = {
	/** "009", or "009D" for the brigade's D lines. */
	brigadeCode: string
	/** The brigade's real account, what a payment is ticked against. */
	accountCode: string
	brigadeLabel: string
	avisoNumbers: string[]
	/** 65% of the pre-IVU labor (80% on a D row). */
	net: number
	/** 10% of the row's gross share, held back. */
	retention: number
	/** The amount Carmen pays: the brigade total, figured on the brigade's gross. */
	toPay: number
	/** D-line retention is not confirmed with Lissette yet. */
	unverified: boolean
}

/**
 * The request as Carmen and Lissette read it. Gross is the JAF price and is
 * deliberately not carried: this is the only shape of a request that leaves
 * Lissette's desk, so nothing downstream can print what it does not have.
 * Every figure is truncated from the brigade's own gross (see `shareFigures`),
 * so To pay is not always Net − Retention to the cent.
 */
export function payrollSheetLines(blocks: JournalBlock[]): PayrollSheetLine[] {
	return blocks.map((b) => ({
		brigadeCode: b.brigadeCode,
		accountCode: b.accountCode,
		brigadeLabel: b.brigadeLabel,
		avisoNumbers: [
			...new Set(
				b.jobs.map((j) => j.avisoNumber).filter((n): n is string => !!n),
			),
		].sort(),
		net: b.net,
		retention: b.retention,
		toPay: b.totalSC,
		unverified: b.unverified,
	}))
}
