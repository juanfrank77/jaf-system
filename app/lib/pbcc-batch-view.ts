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
	/** Where the Aviso and the invoice open; null when the file is not made yet. */
	avisoHref: string | null
	invoiceHref: string | null
}

export type BatchView = {
	id: string
	/** Null while the batch is open: it is numbered when it is closed. */
	number: number | null
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
