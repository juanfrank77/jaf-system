export type BatchStatus = "open" | "closed" | "sent"

export type BatchRowView = {
	id: string
	/** 1-based, the order the packets were accepted. */
	row: number
	controlNumber: string
	avisoNumber: string | null
	brigade: string | null
	invoiceNumber: string
	subtotal: number
	ivu: number
	total: number
	hasAvisoPdf: boolean
	hasInvoicePdf: boolean
}

export type BatchView = {
	id: string
	number: number
	status: BatchStatus
	closedAt: string | null
	sentAt: string | null
	count: number
	capacity: number
	/** Sum of the rows' subtotals (before IVU): what the advance is figured on. */
	subtotal: number
	advanceRate: number
	advance: number
	hasExcel: boolean
	rows: BatchRowView[]
}

export type BatchSummary = Pick<
	BatchView,
	"id" | "number" | "status" | "closedAt" | "sentAt" | "count" | "subtotal"
>

export const batchStatus = (b: {
	closedAt: Date | null
	sentAt: Date | null
}): BatchStatus => (b.sentAt ? "sent" : b.closedAt ? "closed" : "open")
