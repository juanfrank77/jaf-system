import { avisoSavedWhere } from "~/lib/aviso-document"
import type { Prisma } from "../../generated/prisma/client"

// The supervisor's sidebar queues: Intake (orders just created, before the
// warehouse has prepped them), then one per step of the work-order rail from
// Approve onward. Each is a `?stage=` view of the dashboard, and the same
// `where` drives both the sidebar count and the filtered list, so the pill
// can never disagree with what the link opens.
// Complement of `avisoSavedWhere`: the Aviso number or its PDF is still missing.
const avisoNotSavedWhere = {
	OR: [{ avisoNumber: null }, { avisoDocPath: null }],
} satisfies Prisma.JafInvoiceWhereInput

export type SupervisorQueue =
	| "open"
	| "returned"
	| "intake"
	| "field"
	| "review"
	| "invoice"
	| "aviso"
	| "precert"
	| "released"
	| "all"

export const SUPERVISOR_QUEUES: SupervisorQueue[] = [
	"open",
	"returned",
	"intake",
	"field",
	"review",
	"invoice",
	"aviso",
	"precert",
	"released",
	"all",
]

// The sidebar queues, in display order. Intake and Field have no sidebar links
// (intake opens from the "Awaiting warehouse" tile; field shows on the dashboard
// cards), and Review stays a queue (and a route) but is hidden from the sidebar.
// nav-counts reads this list, so the sidebar order and the count set stay in sync.
export const SUPERVISOR_SIDEBAR_QUEUES: SupervisorQueue[] = [
	"open",
	"returned",
	"invoice",
	"aviso",
	"precert",
	"released",
	"all",
] as const

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
 * signed). `open` (My open jobs) is the steps before the packet (Intake to
 * Sign off), so it is disjoint from the packet-onward queues. `invoice`
 * (Packets to Claro) spans sent and not yet sent, so it overlaps `aviso`;
 * `field` and `review` sit inside `open`; the rest are disjoint.
 */
export function supervisorQueueWhere(
	queue: SupervisorQueue,
	/** The supervisor's returned packets (`returnedDocIds`): their own queue,
	 * and left out of every step queue. "Returned" lives in the JSON history,
	 * so it is resolved to ids first rather than filtered in SQL. */
	returnedIds: string[] = [],
): Prisma.JafInvoiceWhereInput {
	if (queue === "returned")
		return { id: { in: returnedIds }, status: { not: "CANCELLED" } }
	const where = stepQueueWhere(queue)
	return queue === "all" || returnedIds.length === 0
		? where
		: { ...where, id: { notIn: returnedIds } }
}

function stepQueueWhere(
	queue: Exclude<SupervisorQueue, "returned">,
): Prisma.JafInvoiceWhereInput {
	switch (queue) {
		// The steps before the packet exists: Intake, Warehouse, Field and Sign
		// off. From the packet onward a job lives in its own sidebar queue.
		case "open":
			return {
				releasedToFinanceAt: null,
				...avisoNotSavedWhere,
				supervisorApprovedAt: null,
				jafInvoiceGeneratedAt: null,
				status: { in: ["CREATED", "PREPPED", "SIGNED", "FIELD_UPDATED"] },
			}
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
				...avisoSavedWhere,
				status: { not: "CANCELLED" },
			}
		case "aviso":
			return {
				releasedToFinanceAt: null,
				...avisoNotSavedWhere,
				jafInvoiceGeneratedAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "invoice":
			return {
				releasedToFinanceAt: null,
				...avisoNotSavedWhere,
				supervisorApprovedAt: { not: null },
				status: { not: "CANCELLED" },
			}
		case "review":
			return {
				releasedToFinanceAt: null,
				...avisoNotSavedWhere,
				jafInvoiceGeneratedAt: null,
				supervisorApprovedAt: null,
				status: "FIELD_UPDATED",
			}
		case "all":
			return { status: { not: "LC_REQUEST_GENERATED" } }
	}
}
