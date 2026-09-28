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

/**
 * Live prep-time availability preview: on-hand at `warehouseId` minus
 * reserved qty from every currently-PREPPED (staged-but-not-released) doc,
 * summed ACROSS ALL WAREHOUSES.
 *
 * A PREPPED doc has no `warehouseId` yet — it's only set at sign/pickup
 * (crew may pull from a different zone warehouse than the one that prepped
 * it), so which warehouse will eventually absorb its release is unknown at
 * prep time. Subtracting the all-warehouse reserved total from a single
 * warehouse's on-hand is deliberately conservative: it never overstates
 * availability, though it may understate it when two warehouses are both
 * prepping the same material — an acceptable trade, since over-draw is
 * already allowed everywhere else in this spec; under-availability here is
 * just a more cautious number, never a blocked action.
 *
 * Reads `preppedQty` off the stored PrepLine — the actual shape
 * `_app.docs.$id_.prep.tsx`'s action writes to `preppedMaterials` (not the
 * bare `qty` field of an estimatedMaterials-style line).
 */
export async function getPrepAvailable(
	client: StockClient,
	warehouseId: string,
	serviceCodeId: string,
): Promise<number> {
	const onHand = await getBulkOnHand(client, warehouseId, serviceCodeId)
	const staged = await client.jafInvoice.findMany({
		where: { status: "PREPPED" },
		select: { preppedMaterials: true },
	})
	const reserved = staged
		.flatMap(
			(s) =>
				(s.preppedMaterials as
					| { serviceCodeId: string; preppedQty: number }[]
					| null) ?? [],
		)
		.filter((m) => m.serviceCodeId === serviceCodeId)
		.reduce((a, m) => a + (m.preppedQty ?? 0), 0)
	return onHand - reserved
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
