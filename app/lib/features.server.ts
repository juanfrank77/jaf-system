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

/**
 * Step 5 emails the packet to the Claro supervisor only when
 * PACKET_EMAIL_ENABLED=true. Off by default: the supervisor emails the PDF
 * stored at step 4 and marks it sent.
 */
export function isPacketEmailEnabled(): boolean {
	return process.env.PACKET_EMAIL_ENABLED === "true"
}
