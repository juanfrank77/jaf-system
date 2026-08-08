export type FinanceStage =
	| "TO_VERIFY"
	| "PBCC_REQUEST_PENDING"
	| "WAITING_PBCC_FUNDING"
	| "WAITING_CLARO_PO"
	| "PO_RECEIVED_UPLOAD"
	| "IN_CLARO_QUEUE"
	| "READY_TO_CLOSE"
	| "CLOSED"

export type FinanceStageLabelKey =
	| "finance.stage.to_verify"
	| "finance.stage.pbcc_request_pending"
	| "finance.stage.waiting_pbcc_funding"
	| "finance.stage.waiting_claro_po"
	| "finance.stage.po_received_upload"
	| "finance.stage.in_claro_queue"
	| "finance.stage.ready_to_close"
	| "finance.stage.closed"

export const FINANCE_STAGES: FinanceStage[] = [
	"TO_VERIFY",
	"PBCC_REQUEST_PENDING",
	"WAITING_PBCC_FUNDING",
	"WAITING_CLARO_PO",
	"PO_RECEIVED_UPLOAD",
	"IN_CLARO_QUEUE",
	"READY_TO_CLOSE",
	"CLOSED",
]

export const financeStageLabelKey = (
	stage: FinanceStage,
): FinanceStageLabelKey => {
	const map: Record<FinanceStage, FinanceStageLabelKey> = {
		TO_VERIFY: "finance.stage.to_verify",
		PBCC_REQUEST_PENDING: "finance.stage.pbcc_request_pending",
		WAITING_PBCC_FUNDING: "finance.stage.waiting_pbcc_funding",
		WAITING_CLARO_PO: "finance.stage.waiting_claro_po",
		PO_RECEIVED_UPLOAD: "finance.stage.po_received_upload",
		IN_CLARO_QUEUE: "finance.stage.in_claro_queue",
		READY_TO_CLOSE: "finance.stage.ready_to_close",
		CLOSED: "finance.stage.closed",
	}
	return map[stage]
}
