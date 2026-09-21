/**
 * Confirms van_stock_level exists and is reachable via Prisma.
 *
 * Usage: pnpm exec tsx scripts/verify-van-stock-level-table.ts
 */
import { db } from "../app/lib/db.server"

async function main() {
	const rowCount = await db.vanStockLevel.count()
	console.log(`van_stock_level row_count=${rowCount}`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => db.$disconnect())
