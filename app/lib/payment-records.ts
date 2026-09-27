import type { PaymentType } from "../../generated/prisma/client"

type ReceivablePaymentType = Extract<
	PaymentType,
	"PBCC_ADVANCE" | "CLARO_FINAL"
>

export function parsePaymentDate(
	value: string | null | undefined,
): Date | null {
	if (!value) return null
	const [year, month, day] = value.split("-").map(Number)
	if (
		!year ||
		!month ||
		!day ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31
	) {
		return null
	}
	const date = new Date(year, month - 1, day)
	return date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
		? date
		: null
}

export function paymentForType<T extends { type: string }>(
	records: readonly T[],
	type: ReceivablePaymentType,
) {
	return records.find((record) => record.type === type) ?? null
}
