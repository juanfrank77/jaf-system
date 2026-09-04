import type {
	DocStatus,
	JafInvoice,
	ServiceCode,
} from "../../generated/prisma/client"
import { db } from "./db.server"
import {
	FINANCE_STAGES,
	type FinanceStage,
	type FinanceStageLabelKey,
	financeStageLabelKey,
} from "./finance-pipeline"
import { getAvisoAmountTolerance, getIvuRate } from "./system-settings.server"
import { toNumberPrice } from "./utils"

export {
	FINANCE_STAGES,
	type FinanceStage,
	type FinanceStageLabelKey,
	financeStageLabelKey,
}

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

export const financeStageAlertDays = (
	stage: FinanceStage,
	agingAlertDays: number,
): number | null => {
	switch (stage) {
		case "WAITING_CLARO_PO":
			return agingAlertDays
		case "IN_CLARO_QUEUE":
			return agingAlertDays
		default:
			return null
	}
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

function stageAnchorDate(
	invoice: Pick<
		JafInvoice,
		| "supervisorApprovedAt"
		| "financeVerifiedAt"
		| "pbccRequestSentAt"
		| "advanceReceivedAt"
		| "finalClaroUploadedAt"
		| "finalPaymentReceivedAt"
		| "receivableClosedAt"
	>,
	stage: FinanceStage,
	poDate: Date | null | undefined,
	paymentRecords: readonly FinancePayment[] = [],
): Date | null {
	switch (stage) {
		case "TO_VERIFY":
			return invoice.supervisorApprovedAt
		case "PBCC_REQUEST_PENDING":
			return invoice.financeVerifiedAt
		case "WAITING_PBCC_FUNDING":
			return invoice.pbccRequestSentAt
		case "WAITING_CLARO_PO":
			return (
				paymentRecords.find((payment) => payment.type === "PBCC_ADVANCE")
					?.date ?? invoice.advanceReceivedAt
			)
		case "PO_RECEIVED_UPLOAD":
			return poDate ?? null
		case "IN_CLARO_QUEUE":
			return invoice.finalClaroUploadedAt
		case "READY_TO_CLOSE":
			return (
				paymentRecords.find((payment) => payment.type === "CLARO_FINAL")
					?.date ?? invoice.finalPaymentReceivedAt
			)
		case "CLOSED":
			return invoice.receivableClosedAt
	}
}

export function daysInStage(
	invoice: Pick<
		JafInvoice,
		| "supervisorApprovedAt"
		| "financeVerifiedAt"
		| "pbccRequestSentAt"
		| "advanceReceivedAt"
		| "finalClaroUploadedAt"
		| "finalPaymentReceivedAt"
		| "receivableClosedAt"
	>,
	stage: FinanceStage,
	poDate: Date | null | undefined,
	paymentRecords: readonly FinancePayment[] = [],
): number {
	const anchor = stageAnchorDate(invoice, stage, poDate, paymentRecords)
	if (!anchor) return 0
	return Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
}

export function invoiceTotalUsed(
	invoice: Pick<JafInvoice, "materialsUsed" | "materialsTaken">,
	codeMap: Record<string, { unitPrice: number }>,
	ivuRate: number,
): number {
	const used = (invoice.materialsUsed as MaterialItem[]) || []
	const source =
		used.length > 0 ? used : (invoice.materialsTaken as MaterialItem[]) || []
	const subtotal = source.reduce((sum, item) => {
		const price = toNumberPrice(codeMap[item.serviceCodeId]?.unitPrice)
		return sum + Number(item.qty || 0) * price
	}, 0)
	return subtotal + subtotal * ivuRate
}

export function isMissingAviso(
	invoice: Pick<JafInvoice, "avisoNumber">,
): boolean {
	return !invoice.avisoNumber || invoice.avisoNumber.trim() === ""
}

export function isMissingClaroPdf(
	invoice: Pick<JafInvoice, "claroPdfPath">,
): boolean {
	return !invoice.claroPdfPath || invoice.claroPdfPath.trim() === ""
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

export type FinancePipelineRow = {
	id: string
	status: DocStatus
	controlNumber: string
	avisoNumber: string | null
	supervisorName: string
	jobType: string
	stage: FinanceStage
	ageDays: number
	alertDays: number | null
	isAlert: boolean
	amount: number
	missingAviso: boolean
	missingClaroPdf: boolean
	advanceAmount: number | null
	finalPaymentAmount: number | null
	poMismatch: boolean
	poAmount: number | null
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
	invoice: Pick<JafInvoice, "materialsUsed" | "materialsTaken">,
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
	const used = (invoice.materialsUsed as MaterialItem[]) || []
	const source =
		used.length > 0 ? used : (invoice.materialsTaken as MaterialItem[]) || []
	return source.map((item) => {
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
