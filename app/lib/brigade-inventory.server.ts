import type { Prisma } from "../../generated/prisma/client"
import { db } from "./db.server"
import { brigadeStockUse } from "./field-materials"
import { supervisorAreas } from "./supervisor-scope"

/**
 * Brigade stock: the materials each brigade holds on its truck. A balance is
 * the sum of the brigade's movements (see `BrigadeStockMovement`): signed
 * pickups add, field use and confirmed returns subtract, and a count writes
 * the difference so the balance equals what was counted. No prices.
 */

type Client = Prisma.TransactionClient | typeof db
export type StockResult = { ok: true } | { ok: false; errorKey: string }

const err = (key: string): { ok: false; errorKey: string } => ({
	ok: false,
	errorKey: `brigade_stock.errors.${key}`,
})

/** A per-line ceiling, well above any real truck. */
export const MAX_STOCK_QTY = 100000

const isQty = (n: unknown): n is number =>
	typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_STOCK_QTY

/** The brigades a supervisor can order for and count: his own plus his areas'. */
export async function supervisorBrigadeIds(
	client: Client,
	userId: string,
): Promise<string[]> {
	const areas = await supervisorAreas(client as typeof db, userId)
	const rows = await client.brigade.findMany({
		where: {
			active: true,
			isEquipmentAccount: false,
			terminatedAt: null,
			OR: [{ supervisorId: userId }, { area: { in: areas } }],
		},
		select: { id: true },
	})
	return rows.map((b) => b.id)
}

export type BalanceRow = {
	brigadeId: string
	serviceCodeId: string
	balance: number
	lastCountAt: Date | null
}

/** Balance per brigade and material, with the date of the last count. */
export async function brigadeBalances(
	client: Client,
	brigadeIds: string[],
): Promise<BalanceRow[]> {
	if (brigadeIds.length === 0) return []
	const where = { brigadeId: { in: brigadeIds } }
	const [sums, counts] = await Promise.all([
		client.brigadeStockMovement.groupBy({
			by: ["brigadeId", "serviceCodeId"],
			where,
			_sum: { qty: true },
		}),
		client.brigadeStockMovement.groupBy({
			by: ["brigadeId", "serviceCodeId"],
			where: { ...where, type: { in: ["OPENING", "COUNT"] } },
			_max: { at: true },
		}),
	])
	const last = new Map(
		counts.map((c) => [`${c.brigadeId}|${c.serviceCodeId}`, c._max.at]),
	)
	return sums.map((s) => ({
		brigadeId: s.brigadeId,
		serviceCodeId: s.serviceCodeId,
		balance: s._sum.qty ?? 0,
		lastCountAt: last.get(`${s.brigadeId}|${s.serviceCodeId}`) ?? null,
	}))
}

async function balanceOf(
	client: Client,
	brigadeId: string,
	serviceCodeId: string,
): Promise<{ balance: number; hasMovements: boolean }> {
	const sum = await client.brigadeStockMovement.aggregate({
		where: { brigadeId, serviceCodeId },
		_sum: { qty: true },
		_count: true,
	})
	return { balance: sum._sum.qty ?? 0, hasMovements: sum._count > 0 }
}

/** A material a brigade can hold: an active, non-serialized catalog material. */
async function validMaterials(client: Client, ids: string[]) {
	const found = await client.serviceCode.findMany({
		where: {
			id: { in: ids },
			active: true,
			kind: "MATERIAL",
			serialized: false,
		},
		select: { id: true },
	})
	return found.length === new Set(ids).size
}

// ---- Restock request -------------------------------------------------------

export type RestockLineInput = {
	brigadeId: string
	serviceCodeId: string
	qty: number
}

/** One request per visit: lines for any of the supervisor's brigades. */
export async function createRestock(
	supervisorId: string,
	lines: RestockLineInput[],
): Promise<StockResult & { id?: string }> {
	if (lines.length === 0) return err("no_lines")
	if (!lines.every((l) => isQty(l.qty))) return err("bad_qty")
	const mine = new Set(await supervisorBrigadeIds(db, supervisorId))
	if (!lines.every((l) => mine.has(l.brigadeId))) return err("not_your_brigade")
	if (
		!(await validMaterials(
			db,
			lines.map((l) => l.serviceCodeId),
		))
	)
		return err("bad_material")

	const warehouse = await db.user.findMany({
		where: { role: "WAREHOUSE", active: true },
		select: { id: true },
	})
	const request = await db.brigadeRestock.create({
		data: {
			requestedById: supervisorId,
			lines: { create: lines },
		},
	})
	if (warehouse.length > 0)
		await db.notification.createMany({
			data: warehouse.map((w) => ({
				userId: w.id,
				message: "Brigade restock requested — prepare the order",
			})),
		})
	return { ok: true, id: request.id }
}

/** Orlando has the order ready: the requester is alerted. */
export async function markRestockReady(
	id: string,
	warehouseUserId: string,
): Promise<StockResult> {
	const done = await db.brigadeRestock.updateMany({
		where: { id, status: "REQUESTED" },
		data: { status: "READY", readyAt: new Date(), readyById: warehouseUserId },
	})
	if (done.count !== 1) return err("not_requested")
	const request = await db.brigadeRestock.findUniqueOrThrow({ where: { id } })
	await db.notification.create({
		data: {
			userId: request.requestedById,
			message: "Your brigade restock is ready for pickup",
		},
	})
	return { ok: true }
}

/** Withdraw a request before anyone has signed. */
export async function cancelRestock(
	id: string,
	supervisorId: string,
): Promise<StockResult> {
	const done = await db.brigadeRestock.updateMany({
		where: {
			id,
			requestedById: supervisorId,
			status: { in: ["REQUESTED", "READY"] },
			supervisorSignedAt: null,
			warehouseSignedAt: null,
		},
		data: { status: "CANCELLED" },
	})
	return done.count === 1 ? { ok: true } : err("cannot_cancel")
}

/**
 * Both sides sign the pickup. When the second signature lands the request is
 * picked up and each line is added to its brigade's balance, in one
 * transaction so a double click cannot add it twice.
 */
export async function signPickup(
	id: string,
	user: { id: string },
	side: "supervisor" | "warehouse",
): Promise<StockResult> {
	return db.$transaction(async (tx) => {
		const request = await tx.brigadeRestock.findUnique({
			where: { id },
			include: { lines: true },
		})
		if (!request) return err("not_found")
		if (side === "supervisor" && request.requestedById !== user.id)
			return err("not_yours")
		const signedKey =
			side === "supervisor" ? "supervisorSignedAt" : "warehouseSignedAt"
		const claimed = await tx.brigadeRestock.updateMany({
			where: { id, status: "READY", [signedKey]: null },
			data:
				side === "supervisor"
					? { supervisorSignedAt: new Date(), supervisorSignedById: user.id }
					: { warehouseSignedAt: new Date(), warehouseSignedById: user.id },
		})
		if (claimed.count !== 1) return err("cannot_sign")

		const otherSigned =
			side === "supervisor"
				? request.warehouseSignedAt
				: request.supervisorSignedAt
		if (otherSigned) {
			await tx.brigadeRestock.update({
				where: { id },
				data: { status: "PICKED_UP", pickedUpAt: new Date() },
			})
			await tx.brigadeStockMovement.createMany({
				data: request.lines.map((l) => ({
					brigadeId: l.brigadeId,
					serviceCodeId: l.serviceCodeId,
					type: "PICKUP" as const,
					qty: l.qty,
					refRestockId: id,
					byUserId: user.id,
				})),
			})
		}
		return { ok: true }
	})
}

// ---- Counts ----------------------------------------------------------------

/**
 * The supervisor's physical count replaces the expected balance. The first
 * count of a material is the opening count. Any later count that differs
 * needs a reason; the variance (counted - expected) stays on the movement.
 */
export async function recordCount(input: {
	brigadeId: string
	serviceCodeId: string
	counted: number
	reason: string | null
	supervisorId: string
}): Promise<StockResult> {
	const { brigadeId, serviceCodeId, counted, supervisorId } = input
	if (!Number.isInteger(counted) || counted < 0 || counted > MAX_STOCK_QTY)
		return err("bad_qty")
	const mine = await supervisorBrigadeIds(db, supervisorId)
	if (!mine.includes(brigadeId)) return err("not_your_brigade")
	if (!(await validMaterials(db, [serviceCodeId]))) return err("bad_material")
	const reason = input.reason?.trim() || null

	return db.$transaction(async (tx) => {
		const { balance, hasMovements } = await balanceOf(
			tx,
			brigadeId,
			serviceCodeId,
		)
		const delta = counted - balance
		if (hasMovements && delta !== 0 && !reason) return err("reason_required")
		await tx.brigadeStockMovement.create({
			data: {
				brigadeId,
				serviceCodeId,
				type: hasMovements ? "COUNT" : "OPENING",
				qty: delta,
				expectedQty: balance,
				countedQty: counted,
				reason: delta !== 0 ? reason : null,
				byUserId: supervisorId,
			},
		})
		return { ok: true }
	})
}

// ---- Returns ---------------------------------------------------------------

/** The supervisor records a return. It only counts once the warehouse confirms. */
export async function requestReturn(input: {
	brigadeId: string
	serviceCodeId: string
	qty: number
	supervisorId: string
}): Promise<StockResult> {
	const { brigadeId, serviceCodeId, qty, supervisorId } = input
	if (!isQty(qty)) return err("bad_qty")
	const mine = await supervisorBrigadeIds(db, supervisorId)
	if (!mine.includes(brigadeId)) return err("not_your_brigade")
	const { balance } = await balanceOf(db, brigadeId, serviceCodeId)
	if (qty > balance) return err("return_exceeds_balance")
	await db.brigadeStockReturn.create({
		data: { brigadeId, serviceCodeId, qty, requestedById: supervisorId },
	})
	return { ok: true }
}

/** The warehouse confirms the return and the balance subtracts. */
export async function confirmReturn(
	id: string,
	warehouseUserId: string,
): Promise<StockResult> {
	return db.$transaction(async (tx) => {
		const ret = await tx.brigadeStockReturn.findUnique({ where: { id } })
		if (!ret) return err("not_found")
		const { balance } = await balanceOf(tx, ret.brigadeId, ret.serviceCodeId)
		if (ret.qty > balance) return err("return_exceeds_balance")
		const claimed = await tx.brigadeStockReturn.updateMany({
			where: { id, confirmedAt: null },
			data: { confirmedAt: new Date(), confirmedById: warehouseUserId },
		})
		if (claimed.count !== 1) return err("already_confirmed")
		await tx.brigadeStockMovement.create({
			data: {
				brigadeId: ret.brigadeId,
				serviceCodeId: ret.serviceCodeId,
				type: "RETURN",
				qty: -ret.qty,
				refReturnId: id,
				byUserId: warehouseUserId,
			},
		})
		return { ok: true }
	})
}

// ---- Used on a job ---------------------------------------------------------

/**
 * Charge each crew's balance for the truck stock it used on the job. It
 * reconciles against what the job already charged, so saving the field step
 * again (or editing a quantity) never double-counts.
 */
export async function syncUsedFromJob(
	doc: { id: string; brigadeId: string | null; fieldMaterials: unknown },
	userId: string,
): Promise<void> {
	const wanted = new Map(
		brigadeStockUse(doc.fieldMaterials, doc.brigadeId).map((u) => [
			`${u.brigadeId}|${u.serviceCodeId}`,
			u,
		]),
	)
	await db.$transaction(async (tx) => {
		const charged = await tx.brigadeStockMovement.groupBy({
			by: ["brigadeId", "serviceCodeId"],
			where: { refDocId: doc.id, type: "USED" },
			_sum: { qty: true },
		})
		const have = new Map(
			charged.map((c) => [
				`${c.brigadeId}|${c.serviceCodeId}`,
				c._sum.qty ?? 0,
			]),
		)
		const keys = new Set([...wanted.keys(), ...have.keys()])
		for (const key of keys) {
			const [brigadeId, serviceCodeId] = key.split("|")
			const delta =
				-Math.round(wanted.get(key)?.qty ?? 0) - (have.get(key) ?? 0)
			if (delta === 0) continue
			await tx.brigadeStockMovement.create({
				data: {
					brigadeId,
					serviceCodeId,
					type: "USED",
					qty: delta,
					refDocId: doc.id,
					byUserId: userId,
				},
			})
		}
	})
}

/** For the supervisor's sidebar badge: his restocks Ready for pickup. */
export function readyRestockCount(supervisorId: string) {
	return db.brigadeRestock.count({
		where: { requestedById: supervisorId, status: "READY" },
	})
}

/** For the warehouse's badge: orders to prepare or hand over, and returns to confirm. */
export async function warehouseBrigadeStockCount(): Promise<number> {
	const [orders, returns] = await Promise.all([
		db.brigadeRestock.count({
			where: { status: { in: ["REQUESTED", "READY"] } },
		}),
		db.brigadeStockReturn.count({ where: { confirmedAt: null } }),
	])
	return orders + returns
}
