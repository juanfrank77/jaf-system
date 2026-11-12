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

/** `REQ-YYMMDD-NNN` for today in Puerto Rico; NNN restarts at 001 each day. */
export async function nextRestockNumber(
	client: Client,
	now: Date = new Date(),
): Promise<string> {
	const [y, m, d] = now
		.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })
		.split("-")
	const prefix = `REQ-${y.slice(2)}${m}${d}-`
	const last = await client.brigadeRestock.findFirst({
		where: { number: { startsWith: prefix } },
		orderBy: { number: "desc" },
		select: { number: true },
	})
	const n = last?.number ? Number(last.number.slice(prefix.length)) + 1 : 1
	return `${prefix}${String(n).padStart(3, "0")}`
}

/** One request per visit: lines for any of the supervisor's brigades. */
export async function createRestock(
	supervisorId: string,
	lines: RestockLineInput[],
): Promise<StockResult & { id?: string; number?: string }> {
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
	// REQ-YYMMDD-NNN: take the day's next number; two sends at once collide on
	// the unique column and the loser simply takes the next one.
	let request: { id: string; number: string | null } | null = null
	for (let attempt = 0; attempt < 5 && !request; attempt++) {
		try {
			request = await db.brigadeRestock.create({
				data: {
					requestedById: supervisorId,
					number: await nextRestockNumber(db),
					lines: { create: lines },
				},
			})
		} catch (e) {
			const clash =
				typeof e === "object" &&
				e !== null &&
				(e as { code?: string }).code === "P2002"
			if (!clash || attempt === 4) throw e
		}
	}
	if (!request) return err("not_found")
	if (warehouse.length > 0)
		await db.notification.createMany({
			data: warehouse.map((w) => ({
				userId: w.id,
				message: `${request?.number ?? "Brigade restock"} requested — prepare the order`,
			})),
		})
	return { ok: true, id: request.id, number: request.number ?? undefined }
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
			message:
				`Your brigade restock ${request.number ?? ""} is ready for pickup`.replace(
					"  ",
					" ",
				),
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
		},
		data: { status: "CANCELLED" },
	})
	return done.count === 1 ? { ok: true } : err("cannot_cancel")
}

export type HandOverInput = {
	id: string
	/** The warehouse user handing over (the signer picked on the form). */
	releasedById: string
	crewSignerName: string
	crewSignerBrigadeId: string | null
	releaseSignature: string
	crewSignature: string
	/** One entry per line: what was actually given, and why if short. */
	lines: { lineId: string; givenQty: number; note?: string | null }[]
}

const blankSignature = (v: string) => !v || v === "data:,"

/**
 * The hand over: the warehouse gives what it has, the brigade's crew signs
 * with the warehouse, and the request closes as Picked up. Each line adds
 * what was GIVEN (not what was asked) to its brigade's balance; a short line
 * needs a note and alerts the supervisor. One transaction, claimed on the
 * READY status, so a double click cannot add it twice. The supervisor signs
 * nothing.
 */
export async function handOverRestock(
	input: HandOverInput,
): Promise<StockResult> {
	if (
		blankSignature(input.releaseSignature) ||
		blankSignature(input.crewSignature)
	)
		return err("signature_required")
	if (!input.crewSignerName.trim()) return err("crew_signer_required")
	return db.$transaction(async (tx) => {
		const request = await tx.brigadeRestock.findUnique({
			where: { id: input.id },
			include: { lines: true },
		})
		if (!request) return err("not_found")
		if (request.status !== "READY") return err("cannot_sign")

		const byId = new Map(input.lines.map((l) => [l.lineId, l]))
		const given = []
		for (const line of request.lines) {
			const entry = byId.get(line.id)
			if (!entry) return err("bad_given")
			const n = entry.givenQty
			if (!Number.isInteger(n) || n < 0 || n > line.qty) return err("bad_given")
			const note = entry.note?.trim() || null
			if (n < line.qty && !note) return err("short_needs_note")
			given.push({ line, n, note })
		}

		const claimed = await tx.brigadeRestock.updateMany({
			where: { id: input.id, status: "READY" },
			data: {
				status: "PICKED_UP",
				pickedUpAt: new Date(),
				warehouseSignedAt: new Date(),
				warehouseSignedById: input.releasedById,
				releaseSignature: input.releaseSignature,
				crewSignature: input.crewSignature,
				crewSignerName: input.crewSignerName.trim(),
				crewSignerBrigadeId: input.crewSignerBrigadeId,
			},
		})
		if (claimed.count !== 1) return err("cannot_sign")

		for (const g of given)
			await tx.brigadeRestockLine.update({
				where: { id: g.line.id },
				data: { givenQty: g.n, note: g.note },
			})
		const movements = given
			.filter((g) => g.n > 0)
			.map((g) => ({
				brigadeId: g.line.brigadeId,
				serviceCodeId: g.line.serviceCodeId,
				type: "PICKUP" as const,
				qty: g.n,
				refRestockId: input.id,
				byUserId: input.releasedById,
			}))
		if (movements.length > 0)
			await tx.brigadeStockMovement.createMany({ data: movements })

		const short = given.filter((g) => g.n < g.line.qty).length
		await tx.notification.create({
			data: {
				userId: request.requestedById,
				message:
					short > 0
						? `${request.number ?? "Brigade restock"} picked up, but ${short} line${short === 1 ? "" : "s"} came up short. Open it to see the notes`
						: `${request.number ?? "Brigade restock"} picked up. The brigade balance is updated`,
			},
		})
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
