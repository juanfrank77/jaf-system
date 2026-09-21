/**
 * Idempotent backfill: Van.standardStockLevels JSON → van_stock_level table.
 * Run after: pnpm prisma migrate deploy
 *
 * Usage: pnpm exec tsx scripts/backfill-van-stock-levels.ts
 */
import { db } from "../app/lib/db.server"
import { parseLegacyStockLevels } from "../app/lib/van-stock"

const report = {
	vansProcessed: 0,
	rowsInserted: 0,
	rowsUpdated: 0,
	skips: {
		not_array: 0,
		missing_service_code_id: 0,
		invalid_qty: 0,
		duplicate_service_code_id: 0,
		invalid_entry: 0,
		orphan_service_code: 0,
	},
	vanDetails: [] as {
		vanId: string
		name: string
		parsed: number
		inserted: number
		updated: number
		skippedOrphans: number
	}[],
}

function bumpSkip(reason: keyof typeof report.skips) {
	report.skips[reason] += 1
}

async function main() {
	const validServiceCodeIds = new Set(
		(await db.serviceCode.findMany({ select: { id: true } })).map((c) => c.id),
	)

	const vans = await db.van.findMany({
		select: { id: true, name: true, standardStockLevels: true },
		orderBy: { name: "asc" },
	})

	for (const van of vans) {
		report.vansProcessed += 1
		const { levels, skips } = parseLegacyStockLevels(van.standardStockLevels)

		for (const skip of skips) {
			bumpSkip(skip.reason)
		}

		const vanDetail = {
			vanId: van.id,
			name: van.name,
			parsed: levels.length,
			inserted: 0,
			updated: 0,
			skippedOrphans: 0,
		}

		for (const level of levels) {
			if (!validServiceCodeIds.has(level.serviceCodeId)) {
				bumpSkip("orphan_service_code")
				vanDetail.skippedOrphans += 1
				console.warn(
					`[backfill] skip orphan FK van=${van.id} serviceCodeId=${level.serviceCodeId}`,
				)
				continue
			}

			const existing = await db.vanStockLevel.findUnique({
				where: {
					vanId_serviceCodeId: {
						vanId: van.id,
						serviceCodeId: level.serviceCodeId,
					},
				},
			})

			await db.vanStockLevel.upsert({
				where: {
					vanId_serviceCodeId: {
						vanId: van.id,
						serviceCodeId: level.serviceCodeId,
					},
				},
				create: {
					vanId: van.id,
					serviceCodeId: level.serviceCodeId,
					parLevel: level.parLevel,
				},
				update: { parLevel: level.parLevel },
			})

			if (existing) {
				report.rowsUpdated += 1
				vanDetail.updated += 1
			} else {
				report.rowsInserted += 1
				vanDetail.inserted += 1
			}
		}

		report.vanDetails.push(vanDetail)
	}

	console.log(JSON.stringify(report, null, 2))
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => db.$disconnect())
