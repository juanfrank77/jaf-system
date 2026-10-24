import { db } from "~/lib/db.server"
import { toNumberPrice } from "~/lib/utils"
import { Prisma } from "../../generated/prisma/client"

const { Decimal } = Prisma
type Decimal = Prisma.Decimal

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

export const RETENTION_RATE = 0.1

/** Truncate (never round) an exact decimal to whole cents. Money here is
 * computed in `Decimal`, not `number`: `Math.trunc(0.29 * 100) / 100` is 0.28
 * and `4.35` gives 4.34, which would short a brigade a cent on exact values. */
function cents(value: Decimal): Decimal {
	return value.toDecimalPlaces(2, Decimal.ROUND_DOWN)
}

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
 * Adj. Net is truncated from gross, not derived as Net − Retention: the two
 * can differ by a cent, and the client's worked example ($118.45 gross →
 * $69.29) is the truncated gross × 0.585 figure.
 *
 * Per-line values are truncated independently, and every job-level total is
 * the sum of those truncated per-line values — so the stored figures, the L1
 * tiles, the packet and the Production Journal always agree. `netPayable` is
 * the sum of the lines' Adj. Net (what the brigade is actually paid).
 */
export function computeContractorPayment(
	lines: ContractorPaymentLine[],
): ContractorPayment {
	const share = new Decimal(CONTRACTOR_SHARE_PERCENT)
	const retentionRate = new Decimal(RETENTION_RATE)
	const keep = new Decimal(1).minus(retentionRate)

	let grossPayable = new Decimal(0)
	let retentionAmount = new Decimal(0)
	let netPayable = new Decimal(0)

	const contractorShareLines: ContractorShareLine[] = (lines ?? []).map(
		(line) => {
			const gross = cents(
				new Decimal(toNumberPrice(line.qty)).times(
					toNumberPrice(line.jafPrice),
				),
			)
			const net = cents(gross.times(share))
			const retention = cents(net.times(retentionRate))
			const adjNet = cents(gross.times(share).times(keep))
			grossPayable = grossPayable.plus(gross)
			retentionAmount = retentionAmount.plus(retention)
			netPayable = netPayable.plus(adjNet)
			return {
				...line,
				gross: gross.toNumber(),
				sharePercent: CONTRACTOR_SHARE_PERCENT,
				net: net.toNumber(),
				retention: retention.toNumber(),
				adjNet: adjNet.toNumber(),
			}
		},
	)
	return {
		contractorShareLines,
		grossPayable: grossPayable.toNumber(),
		retentionAmount: retentionAmount.toNumber(),
		netPayable: netPayable.toNumber(),
	}
}

/**
 * The code a job's payee resolves by: the one copied at the pre-cert
 * signature, else the lead brigade's own code. The brigade is linked by id on
 * the job, so a packet released without the subcontractor code still reaches
 * its brigade; no names are matched.
 */
export function payeeCode(doc: {
	contractorAccountCode: string | null
	brigade?: { code: string | null } | null
}): string | null {
	return doc.contractorAccountCode ?? doc.brigade?.code ?? null
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
