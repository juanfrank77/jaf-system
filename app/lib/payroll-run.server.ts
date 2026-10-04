import {
	computeContractorPayment,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
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
			...armAOpenWhere(),
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
			...armAOpenWhere(),
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
				swept += result.count
			}
			// Every candidate was claimed by a concurrent run: roll back rather than
			// leave an empty run that could be marked paid.
			if (swept === 0) throw new EmptyRunError()
			return { created, swept }
			// The first run sweeps the whole released backlog (one write per job), so
			// the 5s interactive-transaction default is not enough.
		},
		{ timeout: 120_000, maxWait: 10_000 },
	)

	return { run: run.created, sweptCount: run.swept }
}

/**
 * Close a payroll run (Carmen's PAID): stamp `paidAt` on the run, stamp
 * `payablesClosedAt`/`payablesClosedById` on every member invoice (which is
 * what removes them from Arm A and therefore from L1), and notify FINANCE.
 * No ACH reference is kept — Carmen pays outside the system (q&a 15.2).
 *
 * Today the screen calls it with `confirmedByFallback: true`; a later phase's
 * dedicated Carmen screen is expected to pass `false` so both paths stay on one
 * transaction. `reversedAt` / `reversedById` / `reverseReason` on PayrollRun are
 * the schema hook for the admin-only reversal planned for Phase 5 (q&a 15.5);
 * nothing writes them yet.
 *
 * Throws 409 if the run is already closed — see the conditional claim below.
 */
export async function closePayrollRun(opts: {
	runId: string
	paidById: string
	/** The date the run was paid; stamped on `PayrollRun.paidAt`. */
	paidDate: Date
	evidencePath?: string | null
	confirmedByFallback: boolean
}): Promise<{ closedCount: number }> {
	const closedCount = await db.$transaction(async (tx) => {
		// The close is a single CONDITIONAL transition, not an unconditional
		// write. Only an open run (unpaid, unreversed) can be claimed, and the
		// claim is the guard: two overlapping batch_confirm calls serialize on
		// this row's lock, and the second re-checks the WHERE on wake, matches
		// zero rows, and is rejected. This is the same shape as the per-row
		// conditional claim in `generateRun`.
		//
		// Without it the only protection was the React component hiding the form
		// once `paidAt` is set, so a double-submit, a replay, or a stale tab
		// re-stamped the paid date/paidBy/evidence path on the run AND on
		// every member invoice, and notified every FINANCE user a second time.
		const claimed = await tx.payrollRun.updateMany({
			where: { id: opts.runId, paidAt: null, reversedAt: null },
			data: {
				paidAt: opts.paidDate,
				paidById: opts.paidById,
				evidencePath: opts.evidencePath ?? null,
				confirmedByFallback: opts.confirmedByFallback,
			},
		})
		if (claimed.count === 0) {
			throw new Response("Payroll run is already closed", { status: 409 })
		}
		const closed = await tx.jafInvoice.updateMany({
			where: { payrollRunId: opts.runId },
			data: {
				// When the system closed the job, not the user-typed pay date.
				payablesClosedAt: new Date(),
				payablesClosedById: opts.paidById,
			},
		})
		const { label } = await tx.payrollRun.findUniqueOrThrow({
			where: { id: opts.runId },
			select: { label: true },
		})
		const financeUsers = await tx.user.findMany({
			where: { role: "FINANCE", active: true },
			select: { id: true },
		})
		if (financeUsers.length > 0) {
			await tx.notification.createMany({
				data: financeUsers.map((u) => ({
					userId: u.id,
					message: `Run ${label} paid — ${closed.count} Avisos payroll confirmed.`,
				})),
			})
		}
		return closed.count
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
