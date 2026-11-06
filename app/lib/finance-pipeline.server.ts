import { hasAvisoPdf } from "~/lib/aviso-document"
import type {
	DocStatus,
	JafInvoice,
	ServiceCode,
} from "../../generated/prisma/client"
import { db } from "./db.server"
import { hasFieldTable, warehouseUsedLines } from "./field-materials"
import type { FinanceStage } from "./finance-pipeline"
import { computeInvoiceTotals } from "./invoice-totals"
import { getAvisoAmountTolerance, getIvuRate } from "./system-settings.server"
import { toNumberPrice } from "./utils"

export async function fetchInvoiceTotalContext(): Promise<{
	serviceCodes: ServiceCode[]
	codeMap: Record<string, { unitPrice: number }>
	ivuRate: number
	tolerance: number
}> {
	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)
	const [ivuRate, tolerance] = await Promise.all([
		getIvuRate(),
		getAvisoAmountTolerance(),
	])
	return { serviceCodes, codeMap, ivuRate, tolerance }
}

type FinancePayment = {
	type: string
	date?: Date | null
	amount?: unknown
}

type MaterialItem = {
	serviceCodeId: string
	qty: number
}

function hasFinancePayment(
	paymentRecords: readonly FinancePayment[],
	type: "PBCC_ADVANCE" | "CLARO_FINAL",
): boolean {
	return paymentRecords.some((payment) => payment.type === type)
}

export function computeFinanceStage(
	invoice: Pick<
		JafInvoice,
		| "status"
		| "receivableClosedAt"
		| "advanceReceivedAt"
		| "finalPaymentReceivedAt"
		| "finalClaroUploadedAt"
		| "pbccRequestSentAt"
		| "financeVerifiedAt"
	>,
	hasPoLinks: boolean,
	paymentRecords: readonly FinancePayment[],
): FinanceStage | null {
	// Finance only cares about jobs that have reached supervisor approval.
	if (!FINANCEABLE_STATUSES.includes(invoice.status)) return null

	if (invoice.receivableClosedAt) return "CLOSED"
	if (
		hasFinancePayment(paymentRecords, "PBCC_ADVANCE") &&
		hasFinancePayment(paymentRecords, "CLARO_FINAL")
	)
		return "READY_TO_CLOSE"
	if (invoice.finalClaroUploadedAt) return "IN_CLARO_QUEUE"
	if (hasPoLinks) return "PO_RECEIVED_UPLOAD"
	if (hasFinancePayment(paymentRecords, "PBCC_ADVANCE"))
		return "WAITING_CLARO_PO"
	if (invoice.pbccRequestSentAt) return "WAITING_PBCC_FUNDING"
	if (invoice.financeVerifiedAt) return "PBCC_REQUEST_PENDING"
	return "TO_VERIFY"
}

type MaterialsSource = Pick<JafInvoice, "materialsUsed" | "materialsTaken"> &
	Partial<Pick<JafInvoice, "fieldMaterials">>

/**
 * The material lines Finance bills. With a Field table that is its WAREHOUSE
 * use only: brigade's own stock is tracked, not billed (provisional ruling),
 * and nothing used from the pickup bills nothing. A job without the table
 * reads `materialsUsed`, or the pickup when nothing was reported used.
 */
export function billableMaterials(invoice: MaterialsSource): MaterialItem[] {
	// Finance corrected the packet to the Aviso: her lines are what is billed.
	if (((invoice as { invoiceVersion?: number }).invoiceVersion ?? 1) > 1)
		return (invoice.materialsUsed as MaterialItem[]) || []
	if (hasFieldTable(invoice.fieldMaterials))
		return warehouseUsedLines(invoice.fieldMaterials, invoice.materialsUsed)
	const used = (invoice.materialsUsed as MaterialItem[]) || []
	return used.length > 0
		? used
		: (invoice.materialsTaken as MaterialItem[]) || []
}

export function isMissingAvisoPdf(
	invoice: Pick<JafInvoice, "avisoDocPath" | "claroPdfPath">,
): boolean {
	return !hasAvisoPdf(invoice)
}

export function checkAmountTolerance(
	invoiceTotal: number,
	avisoAmount: number,
	tolerance: number,
): { withinTolerance: boolean; difference: number } {
	const difference = Math.abs(invoiceTotal - avisoAmount)
	return {
		withinTolerance: difference <= tolerance,
		difference,
	}
}

export const FINANCEABLE_STATUSES: DocStatus[] = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
]

type FinanceLineItem = {
	claroCode: string
	name: string
	qty: number
	unit: string
	unitPrice: number
	accountCode?: string | null
}

export function financeLineItems(
	invoice: MaterialsSource,
	codeMap: Record<
		string,
		{
			claroCode?: string
			name?: string
			unit?: string | null
			unitPrice: unknown
			accountCode?: string | null
		}
	>,
): FinanceLineItem[] {
	return billableMaterials(invoice).map((item) => {
		const code = codeMap[item.serviceCodeId]
		return {
			claroCode: code?.claroCode ?? "",
			name: code?.name ?? "",
			qty: Number(item.qty) || 0,
			unit: code?.unit ?? "SR",
			unitPrice: toNumberPrice(code?.unitPrice),
			accountCode: code?.accountCode,
		}
	})
}
