/**
 * Feature flags read from environment at runtime.
 *
 * These helpers are server-only because they access process.env.
 */

export function isComptrollerEnabled(): boolean {
	return process.env.ENABLE_COMPTROLLER === "true"
}

/** Dashboard filter bar. On by default (Phase 3, Sept 2026); disable with ENABLE_DASHBOARD_FILTERS=false. */
export function isDashboardFiltersEnabled(): boolean {
	return process.env.ENABLE_DASHBOARD_FILTERS !== "false"
}
