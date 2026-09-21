/**
 * Feature flags read from environment at runtime.
 *
 * These helpers are server-only because they access process.env.
 */

export function isComptrollerEnabled(): boolean {
	return process.env.ENABLE_COMPTROLLER === "true"
}

/** Dashboard filter bar. Hidden by default (Phase 3, Sept 2026); the loader still honours the query params. */
export function isDashboardFiltersEnabled(): boolean {
	return process.env.ENABLE_DASHBOARD_FILTERS === "true"
}

/** Master switch for all design-system v2 screens. */
export function isDesignSystemEnabled(): boolean {
	return process.env.ENABLE_DESIGN_SYSTEM === "true"
}

/** Installer dashboard with design-system components. */
export function isInstallerDashboardV2Enabled(): boolean {
	return (
		isDesignSystemEnabled() && process.env.ENABLE_INSTALLER_DASH_V2 === "true"
	)
}

/** Installer adjust + install wizard. */
export function isInstallerV2Enabled(): boolean {
	return isDesignSystemEnabled() && process.env.ENABLE_INSTALLER_V2 === "true"
}

/** Warehouse prep, pickup (sign), and returns. */
export function isWarehouseV2Enabled(): boolean {
	return isDesignSystemEnabled() && process.env.ENABLE_WAREHOUSE_V2 === "true"
}

/** Crew field update. */
export function isCrewV2Enabled(): boolean {
	return isDesignSystemEnabled() && process.env.ENABLE_CREW_V2 === "true"
}

/** Supervisor review. */
export function isSupervisorV2Enabled(): boolean {
	return isDesignSystemEnabled() && process.env.ENABLE_SUPERVISOR_V2 === "true"
}

/** Design-system app shell (top bar + rail). */
export function isDsShellEnabled(): boolean {
	return isDesignSystemEnabled() && process.env.ENABLE_DS_SHELL === "true"
}
