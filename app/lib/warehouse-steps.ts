// The warehouse department's own work loop, in the order a unit
// travels through it: a serial owed back is scanned in (RETURNED),
// triaged to a disposition, holds are reviewed by the lead, failed
// units go through the repair loop, stock is released to vans, and
// the ledger itself is audited. Every screen in the department is
// exactly one step of this loop, so each screen renders a
// `WarehouseStepRail` naming its step (mockup v3 priority 3: "Step
// rail + callout on every screen").
export type WarehouseStep =
	| "SCAN_IN"
	| "TRIAGE"
	| "REVIEW"
	| "REPAIRS"
	| "RESTOCK"
	| "STOCK"

export const WAREHOUSE_STEPS: WarehouseStep[] = [
	"SCAN_IN",
	"TRIAGE",
	"REVIEW",
	"REPAIRS",
	"RESTOCK",
	"STOCK",
]

/** Route per step — the rail links a step back to its screen. */
export const WAREHOUSE_STEP_HREF: Record<WarehouseStep, string> = {
	SCAN_IN: "/warehouse/scan-in",
	TRIAGE: "/warehouse/triage",
	REVIEW: "/warehouse/needs-review",
	REPAIRS: "/warehouse/repairs",
	RESTOCK: "/warehouse/restock",
	STOCK: "/warehouse/stock",
}

/** i18n key per step, inside the `warehouse_flow.step` namespace. */
export const WAREHOUSE_STEP_LABEL_KEY = {
	SCAN_IN: "warehouse_flow.step.scan_in",
	TRIAGE: "warehouse_flow.step.triage",
	REVIEW: "warehouse_flow.step.review",
	REPAIRS: "warehouse_flow.step.repairs",
	RESTOCK: "warehouse_flow.step.restock",
	STOCK: "warehouse_flow.step.stock",
} as const
