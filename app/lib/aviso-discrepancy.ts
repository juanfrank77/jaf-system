import type { MaterialDifference } from "./aviso-materials"

export type AvisoDiscrepancy = {
	detectedAt: string
	differences: MaterialDifference[]
	note: string | null
	noteAt: string | null
	noteById: string | null
}

export const DISCREPANCY_STALE_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

export function discrepancyAgeDays(d: AvisoDiscrepancy, now: Date): number {
	return Math.floor((now.getTime() - new Date(d.detectedAt).getTime()) / DAY_MS)
}

export function isDiscrepancyStale(
	d: AvisoDiscrepancy | null,
	now: Date,
): boolean {
	return d !== null && discrepancyAgeDays(d, now) >= DISCREPANCY_STALE_DAYS
}
