/**
 * Feature flags read from environment at runtime.
 *
 * These helpers are server-only because they access process.env.
 */

export function isComptrollerEnabled(): boolean {
	return process.env.ENABLE_COMPTROLLER === "true"
}
