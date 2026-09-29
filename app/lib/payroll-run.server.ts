import {
	type ContractorPaymentLine,
	computeContractorPayment,
	resolveContractorAccount,
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
 */
export function armAOpenWhere(): Prisma.JafInvoiceWhereInput {
	return {
		releasedToFinanceAt: { not: null },
		payablesClosedAt: null,
		payrollRunId: null,
		paymentRecords: { none: { type: "PBCC_ADVANCE" } },
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
	const toSweep: Array<{
		id: string
		lines: ContractorPaymentLine[]
		accountId: string
		sharePercent: number
	}> = []
	for (const doc of candidates) {
		const account = await resolveContractorAccount(doc.contractorAccountCode)
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
		await tx.payrollRun.update({
			where: { id: opts.runId },
			data: {
			paidAt: opts.achDate,
			paidById: opts.paidById,
			evidencePath: opts.evidencePath ?? null,
				confirmedByFallback: opts.confirmedByFallback,
			},
		})
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
