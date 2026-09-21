/**
 * Read-only shape inspection for Van.standardStockLevels.
 * Hard gate before backfill on staging/production.
 *
 * Usage: pnpm exec tsx scripts/inspect-van-stock-levels.ts
 */
import { db } from "../app/lib/db.server"
import { parseLegacyStockLevels } from "../app/lib/van-stock"

async function main() {
	const vans = await db.van.findMany({
		select: { id: true, name: true, standardStockLevels: true },
		orderBy: { name: "asc" },
	})

	const distinctKeys = new Set<string>()
	let nonConformingEntryCount = 0
	const nonConformingSamples: unknown[] = []
	const duplicateServiceCodeRows: {
		vanId: string
		name: string
		serviceCodeId: string
	}[] = []

	for (const van of vans) {
		const json = van.standardStockLevels
		const jsonType = Array.isArray(json) ? "array" : typeof json
		const arrayLength = Array.isArray(json) ? json.length : null

		if (Array.isArray(json)) {
			const seen = new Set<string>()
			for (const entry of json) {
				if (entry && typeof entry === "object" && !Array.isArray(entry)) {
					for (const key of Object.keys(entry)) {
						distinctKeys.add(key)
					}
				}
				const probe = parseLegacyStockLevels([entry])
				if (probe.levels.length === 0 && probe.skips.length > 0) {
					nonConformingEntryCount += 1
					if (nonConformingSamples.length < 10) {
						nonConformingSamples.push({ vanId: van.id, name: van.name, entry })
					}
				}
				if (
					entry &&
					typeof entry === "object" &&
					"serviceCodeId" in entry &&
					typeof entry.serviceCodeId === "string"
				) {
					if (seen.has(entry.serviceCodeId)) {
						duplicateServiceCodeRows.push({
							vanId: van.id,
							name: van.name,
							serviceCodeId: entry.serviceCodeId,
						})
					}
					seen.add(entry.serviceCodeId)
				}
			}
		}

		console.error(
			JSON.stringify({
				id: van.id,
				name: van.name,
				json_type: jsonType,
				array_length: arrayLength,
			}),
		)
	}

	console.log(
		JSON.stringify(
			{
				vanCount: vans.length,
				distinctObjectKeys: [...distinctKeys].sort(),
				nonConformingEntryCount,
				nonConformingSamples,
				duplicateServiceCodeRows,
			},
			null,
			2,
		),
	)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => db.$disconnect())
