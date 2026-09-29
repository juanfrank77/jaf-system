import {
	type ContractorPaymentLine,
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

export async function generateRun(opts: {
	generatedById: string
	label: string
}): Promise<{ run: { id: string; label: string }; sweptCount: number }> {
	const candidates = await db.jafInvoice.findMany({
		where: armAOpenWhere(),
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
		lines: ContractorPaymentLine[]
		accountId: string
		sharePercent: number
	}> = []
	for (const doc of candidates) {
		if (!doc.contractorAccountCode) continue
		const account = resolved.get(doc.contractorAccountCode)
		if (!account) continue
		toSweep.push({
			id: doc.id,
			lines: toContractorPaymentLines(doc.jafInvoiceLines),
			accountId: account.id,
			sharePercent: account.sharePercent,
		})
	}

	// Each row's write is its own conditional update (`updateMany` +
	// `payrollRunId: null` in the WHERE, not a plain `update`), not a single
	// blanket write per candidate — this is what makes the claim race-safe.
	// If two "Generate run" calls overlap and both read the same candidate
	// before either commits, Postgres serializes their UPDATEs on that row
	// (row-level lock, Read Committed re-checks the WHERE on wake): whichever
	// commits first claims the row; the second's `updateMany` then matches
	// zero rows for it and simply doesn't count it.
	const run = await db.$transaction(async (tx) => {
		const created = await tx.payrollRun.create({
			data: { label: opts.label, generatedById: opts.generatedById },
		})
		let swept = 0
		for (const doc of toSweep) {
			const payment = computeContractorPayment(doc.lines, doc.sharePercent)
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
		return { created, swept }
	})

	return { run: run.created, sweptCount: run.swept }
}

/**
 * Close a payroll run: stamp the ACH payment on the run, stamp
 * `payablesClosedAt`/`payablesClosedById` on every member invoice (which is
 * what removes them from Arm A and therefore from L1), and notify FINANCE.
 *
 * Shared by Lissette's paper-based "batch-confirm" fallback (`confirmedByFallback:
 * true`) and by Phase 5's Carmen screen, which calls it with
 * `confirmedByFallback: false` so the two paths stay on one transaction.
 *
 * Throws 409 if the run is already closed — see the conditional claim below.
 */
export async function closePayrollRun(opts: {
	runId: string
	paidById: string
	achDate: Date
	evidencePath?: string | null
	confirmedByFallback: boolean
}): Promise<{ closedCount: number }> {
	const run = await db.payrollRun.findUniqueOrThrow({
		where: { id: opts.runId },
		include: { invoices: { select: { id: true } } },
	})

	await db.$transaction(async (tx) => {
		// The close is a single CONDITIONAL transition, not an unconditional
		// write. Only an open run (unpaid, unreversed) can be claimed, and the
		// claim is the guard: two overlapping batch_confirm calls serialize on
		// this row's lock, and the second re-checks the WHERE on wake, matches
		// zero rows, and is rejected. This is the same shape as the per-row
		// conditional claim in `generateRun`.
		//
		// Without it the only protection was the React component hiding the form
		// once `paidAt` is set, so a double-submit, a replay, or a stale tab
		// re-stamped the ACH date/paidBy/ACH ref/evidence path on the run AND on
		// every member invoice, and notified every FINANCE user a second time.
		const claimed = await tx.payrollRun.updateMany({
			where: { id: opts.runId, paidAt: null, reversedAt: null },
			data: {
			paidAt: opts.achDate,
			paidById: opts.paidById,
			evidencePath: opts.evidencePath ?? null,
				confirmedByFallback: opts.confirmedByFallback,
			},
		})
		if (claimed.count === 0) {
			throw new Response("Payroll run is already closed", { status: 409 })
		}
		await tx.jafInvoice.updateMany({
			where: { payrollRunId: opts.runId },
			data: {
				payablesClosedAt: opts.achDate,
				payablesClosedById: opts.paidById,
			},
		})
		const financeUsers = await tx.user.findMany({
			where: { role: "FINANCE", active: true },
			select: { id: true },
		})
		if (financeUsers.length > 0) {
			await tx.notification.createMany({
				data: financeUsers.map((u) => ({
					userId: u.id,
					message: `Run ${run.label} paid — ${run.invoices.length} Avisos payroll confirmed.`,
				})),
			})
		}
	})

	return { closedCount: run.invoices.length }
}

export type JournalRow = {
	invoiceId: string
	controlNumber: string
	avisoNumber: string | null
	claroCode: string
}

export type JournalBlock = {
	contractorAccountId: string
	accountCode: string
	contractorLabel: string
	winpayEmployeeCode: string | null
	isPlaceholder: boolean
	gross: number
	net: number
	retention: number
	adjNetRunning: number
	rows: JournalRow[]
}

/**
 * Group a run's invoices into one block per contractor account, with a running
 * cumulative "Adj. net" across the blocks in first-seen order — the figure the
 * paper Production Journal carries down the page.
 *
 * Pure: it reads the already-frozen per-invoice amounts, so a later catalog
 * price change can never move a generated run's journal.
 */
export function buildJournalBlocks(
	invoices: Array<{
		id: string
		controlNumber: string
		avisoNumber: string | null
		grossPayable: unknown
		retentionAmount: unknown
		netPayable: unknown
		contractorAccount: {
			id: string
			code: string
			label: string
			winpayEmployeeCode: string | null
			isPlaceholder: boolean
		} | null
	}>,
): JournalBlock[] {
	const byAccount = new Map<string, JournalBlock>()
	for (const doc of invoices) {
		if (!doc.contractorAccount) continue
		const acc = doc.contractorAccount
		let block = byAccount.get(acc.id)
		if (!block) {
			block = {
				contractorAccountId: acc.id,
				accountCode: acc.code,
				contractorLabel: acc.label,
				winpayEmployeeCode: acc.winpayEmployeeCode,
				isPlaceholder: acc.isPlaceholder,
				gross: 0,
				net: 0,
				retention: 0,
				adjNetRunning: 0,
				rows: [],
			}
			byAccount.set(acc.id, block)
		}
		block.gross += toNumberPrice(doc.grossPayable)
		block.retention += toNumberPrice(doc.retentionAmount)
		block.net += toNumberPrice(doc.netPayable)
		block.rows.push({
			invoiceId: doc.id,
			controlNumber: doc.controlNumber,
			avisoNumber: doc.avisoNumber,
			claroCode: "",
		})
	}
	const blocks = [...byAccount.values()]
	let running = 0
	for (const block of blocks) {
		running += block.net
		block.adjNetRunning = running
	}
	return blocks
}
