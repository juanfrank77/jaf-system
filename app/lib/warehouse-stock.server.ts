import type { db } from "~/lib/db.server"
import type { Prisma } from "../../generated/prisma/client"

// Accepts the full client or a transaction client, so callers can derive
// on-hand inside a release/return transaction.
type StockClient = Prisma.TransactionClient | typeof db

export type BulkStockRow = {
	serviceCodeId: string
	canonicalName: string
	onHand: number
	stockUnit: string | null
	countUnit: string | null
	derivedCountQty: number | null
}
export type SerialStockRow = {
	serviceCodeId: string
	condition: "NEW" | "REFURBISHED"
	count: number
}

// On-hand is always Σ movements (never a stored field). Bulk = Σ qty of
// kind=BULK rows for the warehouse+material.
export async function getBulkOnHand(
	client: StockClient,
	warehouseId: string,
	serviceCodeId: string,
): Promise<number> {
	const agg = await client.stockMovement.aggregate({
		where: { kind: "BULK", warehouseId, serviceCodeId },
		_sum: { qty: true },
	})
	return agg._sum.qty ?? 0
}

export function resolveDualUom(
	onHand: number,
	code: {
		countUnit: string | null
		stockUnit: string | null
		conversionFactor: number | null
	},
) {
	const factor = code.conversionFactor
	return {
		ledgerQty: onHand,
		stockUnit: code.stockUnit,
		countUnit: code.countUnit,
		// null → hide the derived figure (spec §4.4): never fabricate a second unit.
		derivedCountQty: factor && factor !== 0 ? onHand / factor : null,
	}
}

export async function getWarehouseBulkStock(
	client: StockClient,
	warehouseId: string,
): Promise<BulkStockRow[]> {
	const grouped = await client.stockMovement.groupBy({
		by: ["serviceCodeId"],
		where: { kind: "BULK", warehouseId },
		_sum: { qty: true },
	})
	// Join on ServiceCode.id — serviceCodeId is the id, not a Claro string.
	const codes = await client.serviceCode.findMany({
		where: { id: { in: grouped.map((g) => g.serviceCodeId) } },
	})
	const byCode = new Map(codes.map((c) => [c.id, c]))
	return grouped.map((g) => {
		const c = byCode.get(g.serviceCodeId)
		const dual = resolveDualUom(g._sum.qty ?? 0, {
			countUnit: c?.countUnit ?? null,
			stockUnit: c?.stockUnit ?? null,
			conversionFactor: c?.conversionFactor ? Number(c.conversionFactor) : null,
		})
		return {
			serviceCodeId: g.serviceCodeId,
			canonicalName: c?.canonicalName ?? c?.name ?? g.serviceCodeId,
			onHand: dual.ledgerQty,
			stockUnit: dual.stockUnit,
			countUnit: dual.countUnit,
			derivedCountQty: dual.derivedCountQty,
		}
	})
}

export async function getWarehouseSerialStock(
	client: StockClient,
	warehouseId: string,
): Promise<SerialStockRow[]> {
	const grouped = await client.serialLocation.groupBy({
		by: ["serviceCodeId", "condition"],
		where: { status: "WAREHOUSE", currentRef: warehouseId },
		_count: true,
	})
	return grouped.map((g) => ({
		serviceCodeId: g.serviceCodeId,
		condition: g.condition,
		count: g._count,
	}))
}
