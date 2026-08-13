export type GpsCoordinates = {
	lat: number
	lng: number
	accuracy?: number
	capturedAt: string
}

export type AddressCorrection = {
	original: string
	corrected: string
	correctedById: string
	correctedAt: string
	gps?: GpsCoordinates
}

export function buildAddressCorrection({
	original,
	corrected,
	correctedById,
	gps,
}: {
	original: string
	corrected: string
	correctedById: string
	gps?: GpsCoordinates
}): AddressCorrection {
	return {
		original: original.trim(),
		corrected: corrected.trim(),
		correctedById,
		correctedAt: new Date().toISOString(),
		gps,
	}
}

export function mergeAddressCorrections({
	existing,
	correction,
}: {
	existing: AddressCorrection[] | null | undefined
	correction: AddressCorrection
}): AddressCorrection[] {
	const history = Array.isArray(existing) ? existing : []
	return [...history, correction]
}

export function parseGpsCoordinates(
	raw: string | null | undefined,
): GpsCoordinates | undefined {
	if (!raw) return undefined
	try {
		const parsed = JSON.parse(raw)
		if (
			typeof parsed.lat === "number" &&
			typeof parsed.lng === "number" &&
			!Number.isNaN(parsed.lat) &&
			!Number.isNaN(parsed.lng)
		) {
			return {
				lat: parsed.lat,
				lng: parsed.lng,
				accuracy:
					typeof parsed.accuracy === "number" ? parsed.accuracy : undefined,
				capturedAt: parsed.capturedAt || new Date().toISOString(),
			}
		}
	} catch {
		// ignore invalid JSON
	}
	return undefined
}

export function formatTimeOnSite(
	startedAt?: string | Date | null,
	endedAt?: string | Date | null,
): string | null {
	if (!startedAt || !endedAt) return null
	const start = new Date(startedAt).getTime()
	const end = new Date(endedAt).getTime()
	if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
	const minutes = Math.round((end - start) / 60_000)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	const remaining = minutes % 60
	return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
}
