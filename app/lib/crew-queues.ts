import type { Prisma } from "../../generated/prisma/client"

// The crew's sidebar queues: the job-rail steps it owns (Pickup, then the field
// work) plus what it has handed in. Each is a `?stage=` view of the crew
// dashboard, and the same `where` drives the sidebar count and the filtered
// list, so a pill can never disagree with the list it opens.
export type CrewQueue = "pickup" | "field" | "submitted"

export const CREW_QUEUES: CrewQueue[] = ["pickup", "field", "submitted"]

export function parseCrewQueue(value: string | null): CrewQueue | null {
	return CREW_QUEUES.find((q) => q === value) ?? null
}

/** Sidebar / dashboard link for a queue. */
export function crewQueueHref(queue: CrewQueue): string {
	return `/dashboard?stage=${queue}`
}

export const CREW_QUEUE_LABEL_KEY = {
	pickup: "app_shell.nav.crew_pickup",
	field: "app_shell.nav.crew_field",
	submitted: "app_shell.nav.crew_submitted",
} as const

/** The dashboard row kinds each queue shows. "Field" covers both jobs on site
 * and jobs the supervisor sent back to the field. */
export const CREW_QUEUE_KINDS = {
	pickup: ["ready"],
	field: ["sent_back", "on_site"],
	submitted: ["submitted"],
} as const

/** Jobs in a queue, limited to the crew member's own assignments. */
export function crewQueueWhere(
	queue: CrewQueue,
	userId: string,
): Prisma.JafInvoiceWhereInput {
	const mine = { assignedCrewIds: { has: userId } }
	switch (queue) {
		case "pickup":
			return { ...mine, status: "PREPPED" }
		case "field":
			return { ...mine, status: "SIGNED" }
		case "submitted":
			return { ...mine, status: "FIELD_UPDATED" }
	}
}
