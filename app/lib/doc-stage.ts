import type { SupervisorStage } from "./supervisor-stage"

/**
 * The single vocabulary for "where is this job": the supervisor step rail's
 * labels. Every status chip (dashboard list, job page, review, admin) derives
 * from the stage and renders this label, so no role sees a different word for
 * the same state. The raw `DocStatus` enum is never shown to a user.
 */
export const STAGE_LABEL_KEYS = {
	INTAKE: "step_rail.intake",
	WAREHOUSE: "step_rail.warehouse",
	FIELD: "step_rail.field",
	APPROVE: "step_rail.approve",
	INVOICE: "step_rail.invoice",
	AVISO: "step_rail.aviso",
	PRECERT: "step_rail.precert",
	RELEASE: "step_rail.release",
	RELEASED: "step_rail.released",
} as const satisfies Record<SupervisorStage, string>

export type StageBadgeVariant = "ok" | "warn" | "danger" | "info"

export const STAGE_BADGE_VARIANT: Record<SupervisorStage, StageBadgeVariant> = {
	INTAKE: "warn",
	WAREHOUSE: "info",
	FIELD: "info",
	APPROVE: "warn",
	INVOICE: "info",
	AVISO: "info",
	PRECERT: "info",
	RELEASE: "warn",
	RELEASED: "ok",
}
