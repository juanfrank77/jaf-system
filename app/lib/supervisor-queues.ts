import type { Prisma } from "../../generated/prisma/client"

// The supervisor's sidebar queues: Intake (orders just created, before the
// warehouse has prepped them), then one per step of the work-order rail from
// Approve onward. Each is a `?stage=` view of the dashboard, and the same
// `where` drives both the sidebar count and the filtered list, so the pill
// can never disagree with what the link opens.
export type SupervisorQueue =
	| "intake"
	| "field"
	| "review"
	| "invoice"
	| "aviso"
	| "precert"
	| "released"
	| "all"

export const SUPERVISOR_QUEUES: SupervisorQueue[] = [
	"intake",
	"field",
	"review",
	"invoice",
	"aviso",
	"precert",
	"released",
	"all",
]

export function parseSupervisorQueue(
	value: string | null,
): SupervisorQueue | null {
	return SUPERVISOR_QUEUES.find((q) => q === value) ?? null
}

/** Sidebar / dashboard link for a queue. */
export function supervisorQueueHref(queue: SupervisorQueue): string {
	return `/dashboard?stage=${queue}`
}

/**
 * Mirrors `deriveSupervisorStage`: a job is in the first stage whose
 * milestone it has reached, checked from the end of the process backwards.
 * `precert` covers both Pre-cert and Release (the sheet is still being
 * signed). The list is disjoint, so the five stage queues never overlap.
 */
export function supervisorQueueWhere(
	queue: SupervisorQueue,
): Prisma.JafInvoiceWhereInput {
	switch (queue) {
		case "intake":
			return { status: "CREATED" }
		// Prepped and waiting for the crew, or out in the field: the dashboard's
		// "Awaiting crew" tile. Not a sidebar link.
		case "field":
			return { status: { in: ["PREPPED", "SIGNED"] } }
		case "released":
			return {
				releasedToFinanceAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "precert":
			return {
				releasedToFinanceAt: null,
				avisoMatchedAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "aviso":
			return {
				releasedToFinanceAt: null,
				avisoMatchedAt: null,
				jafInvoiceGeneratedAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "invoice":
			return {
				releasedToFinanceAt: null,
				avisoMatchedAt: null,
				jafInvoiceGeneratedAt: null,
				supervisorApprovedAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "review":
			return {
				releasedToFinanceAt: null,
				avisoMatchedAt: null,
				jafInvoiceGeneratedAt: null,
				supervisorApprovedAt: null,
				status: "FIELD_UPDATED",
			}
		case "all":
			return { status: { not: "LC_REQUEST_GENERATED" } }
	}
}
