/**
 * Feature flags read from environment at runtime.
 *
 * These helpers are server-only because they access process.env.
 */

/** Supervisor material-variance page + nav item. Off unless ENABLE_VARIANCE=true. */
export function isVarianceEnabled(): boolean {
	return process.env.ENABLE_VARIANCE === "true"
}

/** Dashboard filter bar. On by default (Phase 3, Sept 2026); disable with ENABLE_DASHBOARD_FILTERS=false. */
export function isDashboardFiltersEnabled(): boolean {
	return process.env.ENABLE_DASHBOARD_FILTERS !== "false"
}

/**
 * Finance may confirm payroll accounts from paper while Carmen's flow runs
 * side by side with the paper journal. Set PAYROLL_FALLBACK_ENABLED=false at
 * go-live: after that only the comptroller ticks. On unless set to "false".
 */
export function isPayrollFallbackEnabled(): boolean {
	return process.env.PAYROLL_FALLBACK_ENABLED !== "false"
}
