import { db } from "./db.server"
import {
	deriveAccessoryStock,
	deriveSerializedStock,
	owedBack,
} from "./van-inventory-v3"

export async function getVanView(vanId: string) {
	const [serials, movements, pars] = await Promise.all([
		// Matches the leading column of the (status, currentRef) index — a
		// currentRef-only filter can't use it and falls back to a full scan.
		// VAN and REMOVED_PENDING_RETURN are the only statuses this view (and
		// its owedBack/deriveSerializedStock consumers) ever reads for a van.
		db.serialLocation.findMany({
			where: {
				status: { in: ["VAN", "REMOVED_PENDING_RETURN"] },
				currentRef: vanId,
			},
		}),
		db.vanMovement.findMany({ where: { vanId } }),
		db.vanPar.findMany({ where: { vanId } }),
	])
	const parMap = Object.fromEntries(
		pars.map((p) => [p.serviceCodeId, p.parQty]),
	)
	const serializedStock = deriveSerializedStock(serials, vanId)
	const accessoryStock = deriveAccessoryStock(
		movements.filter((m) => !m.serial),
	)

	// A par'd code with zero units on the van must still appear — that's
	// precisely the case a restock exists for. Look up which par'd codes are
	// serialized so a zero-stock one lands in the right bucket.
	const parCodeIds = pars.map((p) => p.serviceCodeId)
	const parCodes =
		parCodeIds.length > 0
			? await db.serviceCode.findMany({
					where: { id: { in: parCodeIds } },
					select: { id: true, serialized: true },
				})
			: []
	const serializedParCodeIds = new Set(
		parCodes.filter((c) => c.serialized).map((c) => c.id),
	)

	const serializedCodeIds = new Set([
		...Object.keys(serializedStock),
		...[...serializedParCodeIds],
	])
	const accessoryCodeIds = new Set([
		...Object.keys(accessoryStock),
		...parCodeIds.filter((id) => !serializedParCodeIds.has(id)),
	])

	const serialized = [...serializedCodeIds].map((serviceCodeId) => ({
		serviceCodeId,
		onVan: serializedStock[serviceCodeId] ?? 0,
		par: parMap[serviceCodeId] ?? null,
	}))
	const accessories = [...accessoryCodeIds].map((serviceCodeId) => ({
		serviceCodeId,
		onVan: accessoryStock[serviceCodeId] ?? 0,
		par: parMap[serviceCodeId] ?? null,
	}))
	const owed = owedBack(serials, vanId).map((serial) => {
		const row = serials.find((s) => s.serial === serial)
		return {
			serial,
			sinceDays: row
				? Math.floor((Date.now() - row.since.getTime()) / 86_400_000)
				: 0,
		}
	})
	return { serialized, accessories, owedBack: owed }
}

export async function getInstallerRollup() {
	const vans = await db.van.findMany({
		where: { active: true },
		include: { installer: true },
	})
	return Promise.all(
		vans.map(async (v) => {
			const view = await getVanView(v.id)
			const belowPar = [...view.serialized, ...view.accessories].filter(
				(r) => r.par != null && r.onVan < r.par,
			).length
			const last = v.installerId
				? await db.installCompletion.findFirst({
						where: { installerId: v.installerId },
						orderBy: { createdAt: "desc" },
					})
				: null
			return {
				installerId: v.installerId ?? "",
				vanId: v.id,
				name: v.installer?.name ?? v.name,
				belowPar,
				owedBack: view.owedBack.length,
				owedBackDetails: view.owedBack,
				lastCompletionAt: last?.createdAt ?? null,
			}
		}),
	)
}
