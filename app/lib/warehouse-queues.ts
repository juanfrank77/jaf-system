import type { JobStep } from "~/lib/job-steps"

// The warehouse's sidebar queues: one page per step of the job rail it owns
// (Prep, Release, Return). The page list, the dashboard card and the sidebar
// pill all read the same `where` (warehouse-queues.server.ts), so a count can
// never disagree with the list it opens.
export type WarehouseQueue = "prep" | "release" | "returns"

export const WAREHOUSE_QUEUES: WarehouseQueue[] = ["prep", "release", "returns"]

/** Sidebar / dashboard link for a queue. */
export function warehouseQueueHref(queue: WarehouseQueue): string {
	return `/warehouse/${queue}`
}

export const NO_WAREHOUSE_COUNTS: Record<WarehouseQueue, number> = {
	prep: 0,
	release: 0,
	returns: 0,
}

export const WAREHOUSE_QUEUE_LABEL_KEY = {
	prep: "app_shell.nav.warehouse_prep",
	release: "app_shell.nav.warehouse_pickup",
	returns: "app_shell.nav.warehouse_returns",
} as const

/** The job-rail steps that have a warehouse page, for the rail's links. */
export const WAREHOUSE_JOB_STEP_HREF: Partial<Record<JobStep, string>> = {
	PREP: warehouseQueueHref("prep"),
	RELEASE: warehouseQueueHref("release"),
	RETURN: warehouseQueueHref("returns"),
}
