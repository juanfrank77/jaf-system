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
