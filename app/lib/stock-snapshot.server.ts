import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { db } from "~/lib/db.server"
import { renderSnapshotPdf } from "~/lib/pdf/stock-snapshot.server"
import {
	type BulkStockRow,
	resolveDualUom,
	type SerialStockRow,
} from "~/lib/warehouse-stock.server"
import type { Prisma } from "../../generated/prisma/client"

type DB = Prisma.TransactionClient | typeof db

// On-hand as of a date = Σ movements with `at <= asOfDate` (never a stored
// figure). Serial-as-of approximates by `since <= asOfDate`.
export async function computeSnapshotAsOf(
	client: DB,
	warehouseId: string,
	asOfDate: Date,
): Promise<{ bulk: BulkStockRow[]; serial: SerialStockRow[] }> {
	const grouped = await client.stockMovement.groupBy({
		by: ["serviceCodeId"],
		where: { kind: "BULK", warehouseId, at: { lte: asOfDate } },
		_sum: { qty: true },
	})
	const codes = await client.serviceCode.findMany({
		where: { id: { in: grouped.map((g) => g.serviceCodeId) } },
	})
	const byId = new Map(codes.map((c) => [c.id, c]))
	const bulk = grouped.map((g) => {
		const c = byId.get(g.serviceCodeId)
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
	const serialGrouped = await client.serialLocation.groupBy({
		by: ["serviceCodeId", "condition"],
		where: {
			status: "WAREHOUSE",
			currentRef: warehouseId,
			since: { lte: asOfDate },
		},
		_count: true,
	})
	const serial = serialGrouped.map((g) => ({
		serviceCodeId: g.serviceCodeId,
		condition: g.condition,
		count: g._count,
	}))
	return { bulk, serial }
}

// Row first (documentPath null) — the export survives even if rendering fails.
export async function createSnapshot(
	client: DB,
	args: { warehouseId: string; asOfDate: Date; userId: string },
) {
	return client.stockSnapshot.create({
		data: {
			warehouseId: args.warehouseId,
			asOfDate: args.asOfDate,
			generatedById: args.userId,
		},
	})
}

// Recompute + render PDF & CSV to deterministic paths, then set them on the
// row. Idempotent/retryable: re-running overwrites the same files.
export async function generateSnapshotArtifacts(
	client: DB,
	snapshotId: string,
): Promise<void> {
	const snap = await client.stockSnapshot.findUniqueOrThrow({
		where: { id: snapshotId },
		include: { warehouse: true },
	})
	const { bulk, serial } = await computeSnapshotAsOf(
		client,
		snap.warehouseId,
		snap.asOfDate,
	)
	const dir = join(process.env.UPLOAD_DIR ?? "/tmp/jaf/uploads", "snapshots")
	await mkdir(dir, { recursive: true })
	const documentPath = join(dir, `${snapshotId}.pdf`)
	const csvPath = join(dir, `${snapshotId}.csv`)
	const pdf = await renderSnapshotPdf({
		warehouseName: snap.warehouse.name,
		asOfDate: snap.asOfDate,
		bulk,
		serial,
	})
	await writeFile(documentPath, pdf)
	const csv = [
		"serviceCodeId,name,onHand,stockUnit,derivedCountQty,countUnit",
		...bulk.map(
			(b) =>
				`${b.serviceCodeId},${JSON.stringify(b.canonicalName)},${b.onHand},${b.stockUnit ?? ""},${b.derivedCountQty ?? ""},${b.countUnit ?? ""}`,
		),
	].join("\n")
	await writeFile(csvPath, csv, "utf8")
	await client.stockSnapshot.update({
		where: { id: snapshotId },
		data: { documentPath, csvPath },
	})
}
