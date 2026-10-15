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

export const WAREHOUSE_QUEUE_LABEL_KEY = {
	prep: "app_shell.nav.warehouse_prep",
	release: "app_shell.nav.warehouse_pickup",
	returns: "app_shell.nav.warehouse_returns",
} as const
