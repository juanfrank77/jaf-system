import { isAvisoSaved } from "~/lib/aviso-document"
import type { JafInvoice } from "../../generated/prisma/client"

/**
 * What a supervisor sees on a job chip: finer than `SupervisorStage` where the
 * stage lumps two states together (`SIGNED` is both "Picked up" and "Field";
 * `INVOICE` is both "Ready to send" and, once the packet is out, "Sent, waiting
 * Aviso"). Nothing renames `DocStatus`; the table lives in the supervisor
 * workflow redesign spec ("Status -> label table").
 */
export type OpenJobLabel =
	| "MATERIAL_REQUESTED"
	| "READY_FOR_PICKUP"
	| "PICKED_UP"
	| "FIELD"
	| "SIGN_OFF"
	| "READY_TO_SEND"
	| "SENT_WAITING_AVISO"
	| "PRECERT"
	| "RELEASE"
	| "RELEASED"

export const OPEN_JOB_LABEL_KEYS = {
	MATERIAL_REQUESTED: "open_job.material_requested",
	READY_FOR_PICKUP: "open_job.ready_for_pickup",
	PICKED_UP: "open_job.picked_up",
	FIELD: "open_job.field",
	SIGN_OFF: "open_job.sign_off",
	READY_TO_SEND: "open_job.ready_to_send",
	SENT_WAITING_AVISO: "open_job.sent_waiting_aviso",
	PRECERT: "open_job.precert",
	RELEASE: "open_job.release",
	RELEASED: "open_job.released",
} as const satisfies Record<OpenJobLabel, string>

/** Timestamps first (latest milestone wins), then status, like `deriveSupervisorStage`. */
export function openJobLabel(
	doc: Pick<
		JafInvoice,
		| "status"
		| "fieldStartedAt"
		| "supervisorApprovedAt"
		| "jafInvoiceGeneratedAt"
		| "avisoNumber"
		| "avisoDocPath"
		| "releasedToFinanceAt"
	>,
	sheet: {
		sigSupervisorAt: Date | null
		sigSubcontractorAt: Date | null
	} | null,
): OpenJobLabel {
	if (doc.releasedToFinanceAt) return "RELEASED"
	if (isAvisoSaved(doc)) {
		return sheet?.sigSupervisorAt && sheet?.sigSubcontractorAt
			? "RELEASE"
			: "PRECERT"
	}
	if (doc.jafInvoiceGeneratedAt) return "SENT_WAITING_AVISO"
	if (doc.supervisorApprovedAt) return "READY_TO_SEND"
	switch (doc.status) {
		case "CREATED":
			return "MATERIAL_REQUESTED"
		case "PREPPED":
			return "READY_FOR_PICKUP"
		case "SIGNED":
			return doc.fieldStartedAt ? "FIELD" : "PICKED_UP"
		case "FIELD_UPDATED":
			return "SIGN_OFF"
		default:
			return "READY_TO_SEND"
	}
}
