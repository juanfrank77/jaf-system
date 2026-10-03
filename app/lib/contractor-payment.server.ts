import { db } from "~/lib/db.server"
import { toNumberPrice, truncateCents } from "~/lib/utils"

/** Fixed brigade share of a JAF invoice. There are no per-account or per-line
 * overrides — see docs/JAF_Finance_answer_Journey.pdf Part 2 §009D/80%.
 * Snapshotted onto each contractorShareLines row at sweep time so a later
 * catalog or rate change never rewrites an already-generated run. */
export const CONTRACTOR_SHARE_PERCENT = 0.65

export type ContractorPaymentLine = {
	serviceCodeId: string
	claroCode: string
	name: string
	qty: number
	jafPrice: number
}

export type ContractorShareLine = ContractorPaymentLine & {
	gross: number
	sharePercent: number
	net: number
	retention: number
	adjNet: number
}

export type ContractorPayment = {
	contractorShareLines: ContractorShareLine[]
	grossPayable: number
	retentionAmount: number
	netPayable: number
}

const RETENTION_RATE = 0.1

/**
 * Map a `JafInvoice.jafInvoiceLines` JSON value into the shape the payment
 * computation needs.
 *
 * The stored lines are `[{ serviceCodeId, claroCode, accountCode, name, unit,
 * qty, unitPrice, lineAmount }]` — the catalog price lives on `unitPrice`, not
 * on a `jafPrice` field. Reading them straight into `ContractorPaymentLine`
 * would silently yield `jafPrice: undefined` (→ 0) and a $0.00 gross for every
 * job, so this conversion is the single place the two shapes are bridged.
 *
 * Non-array / null / unparseable input yields `[]` rather than throwing, so a
 * job with no lines renders `$0.00` cleanly (Review Focus).
 */
export function toContractorPaymentLines(
	value: unknown,
): ContractorPaymentLine[] {
	if (!Array.isArray(value)) return []
	return value.map((raw) => {
		const line = (raw ?? {}) as Record<string, unknown>
		return {
			serviceCodeId: String(line.serviceCodeId ?? ""),
			claroCode: String(line.claroCode ?? ""),
			name: String(line.name ?? ""),
			qty: toNumberPrice(line.qty),
			jafPrice: toNumberPrice(line.unitPrice),
		}
	})
}

/**
 * Compute the brigade's share of an invoice.
 *
 * Rules (from docs/JAF_Finance_answer_Journey.pdf Part 1 § "How the report is built"):
 *   Net       = Gross × 0.65 (CONTRACTOR_SHARE_PERCENT), truncated to cents
 *   Retention = Net × 10%, truncated to cents  (NOT 10% of gross)
 *   Adj. Net  = Gross × 0.65 × 0.90, truncated to cents
 *
 * Per-line values are truncated independently; the totals are the
 * sums of those truncated per-line values — matching the paper
 * Production Journal, which accumulates "Adj. net (running)" down
 * the page from truncated line totals.
 */
export function computeContractorPayment(
	lines: ContractorPaymentLine[],
): ContractorPayment {
	const contractorShareLines: ContractorShareLine[] = (lines ?? []).map(
		(line) => {
			const gross = truncateCents(
				toNumberPrice(line.qty) * toNumberPrice(line.jafPrice),
			)
			const net = truncateCents(gross * CONTRACTOR_SHARE_PERCENT)
			const retention = truncateCents(net * RETENTION_RATE)
			const adjNet = truncateCents(
				gross * CONTRACTOR_SHARE_PERCENT * (1 - RETENTION_RATE),
			)
			return {
				...line,
				gross,
				sharePercent: CONTRACTOR_SHARE_PERCENT,
				net,
				retention,
				adjNet,
			}
		},
	)
	const grossPayable = contractorShareLines.reduce((sum, l) => sum + l.gross, 0)
	const netBeforeRetention = contractorShareLines.reduce(
		(sum, l) => sum + l.net,
		0,
	)
	const retentionAmount = truncateCents(netBeforeRetention * RETENTION_RATE)
	const netPayable = truncateCents(
		grossPayable * CONTRACTOR_SHARE_PERCENT * (1 - RETENTION_RATE),
	)
	return { contractorShareLines, grossPayable, retentionAmount, netPayable }
}

export async function resolveContractorAccount(
	contractorAccountCode: string | null | undefined,
): Promise<{ id: string } | null> {
	if (!contractorAccountCode) return null
	const account = await db.contractorAccount.findFirst({
		where: { code: contractorAccountCode },
		select: { id: true },
	})
	if (!account) return null
	return { id: account.id }
}

type ResolvedContractorAccount = { id: string }

/**
 * Resolve a batch of `contractorAccountCode`s in ONE query, keyed by code.
 *
 * Both batch callers used to call `resolveContractorAccount` per row: the L1
 * loader (up to 200 rows on a page load) and `generateRun` (the widest loop in
 * the feature — the candidate set is unbounded). That is 1 + N round-trips to
 * render a table or claim a run, on a small on-prem Postgres.
 *
 * `ContractorAccount.code` is `@unique`, so the Map can never silently pick a
 * winner between two accounts; `get` returning `undefined` is exactly the
 * "unmapped" case the callers already handle.
 *
 * `active` here means "takes new work" (q&a 14.4), not "payable". The
 * assignment pickers in supervisor-scope.ts are the "no new work" half of 14.4
 * and filter on active there. This half removes the active filter so that a
 * deactivated brigade's open jobs are still swept, frozen, and closed — the
 * brigade still gets paid for work already released, while the pickers keep it
 * off any new job.
 */
export async function resolveContractorAccounts(
	codes: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, ResolvedContractorAccount>> {
	const distinct = [...new Set(codes.filter((c): c is string => !!c))]
	if (distinct.length === 0) return new Map()
	const accounts = await db.contractorAccount.findMany({
		where: { code: { in: distinct } },
		select: { id: true, code: true },
	})
	return new Map(accounts.map((a) => [a.code, { id: a.id }]))
}
