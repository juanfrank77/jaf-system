import { db } from "~/lib/db.server"
import { toNumberPrice } from "~/lib/utils"

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

export function computeContractorPayment(
	lines: ContractorPaymentLine[],
	sharePercent: number,
): ContractorPayment {
	const contractorShareLines: ContractorShareLine[] = (lines ?? []).map(
		(line) => {
			const gross = toNumberPrice(line.qty) * toNumberPrice(line.jafPrice)
			const net = gross * sharePercent
			return { ...line, gross, sharePercent, net }
		},
	)
	const grossPayable = contractorShareLines.reduce((sum, l) => sum + l.gross, 0)
	const netBeforeRetention = contractorShareLines.reduce(
		(sum, l) => sum + l.net,
		0,
	)
	const retentionAmount = grossPayable * RETENTION_RATE
	const netPayable = netBeforeRetention - retentionAmount
	return { contractorShareLines, grossPayable, retentionAmount, netPayable }
}

export async function resolveContractorAccount(
	contractorAccountCode: string | null | undefined,
): Promise<{ id: string; sharePercent: number } | null> {
	if (!contractorAccountCode) return null
	const account = await db.contractorAccount.findUnique({
		where: { code: contractorAccountCode },
		select: { id: true, sharePercent: true },
	})
	if (!account) return null
	return { id: account.id, sharePercent: toNumberPrice(account.sharePercent) }
}

type ResolvedContractorAccount = { id: string; sharePercent: number }

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
 * Deliberately identical in behaviour to the single-code resolver — including
 * NOT filtering on `active`. Filtering inactive accounts out changes which jobs
 * the sweep claims, so it is a separate decision, not something to smuggle in
 * with a performance change.
 */
export async function resolveContractorAccounts(
	codes: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, ResolvedContractorAccount>> {
	const distinct = [...new Set(codes.filter((c): c is string => !!c))]
	if (distinct.length === 0) return new Map()
	const accounts = await db.contractorAccount.findMany({
		where: { code: { in: distinct } },
		select: { id: true, code: true, sharePercent: true },
	})
	return new Map(
		accounts.map((a) => [
			a.code,
			{ id: a.id, sharePercent: toNumberPrice(a.sharePercent) },
		]),
	)
}
