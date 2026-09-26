import { db } from "./db.server"
import {
	deriveAccessoryStock,
	deriveSerializedStock,
	owedBack,
} from "./van-inventory-v3"

export async function getVanView(vanId: string) {
	const [serials, movements, pars] = await Promise.all([
		db.serialLocation.findMany({ where: { OR: [{ currentRef: vanId }] } }),
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
	const serialized = Object.entries(serializedStock).map(
		([serviceCodeId, onVan]) => ({
			serviceCodeId,
			onVan,
			par: parMap[serviceCodeId] ?? null,
		}),
	)
	const accessories = Object.entries(accessoryStock).map(
		([serviceCodeId, onVan]) => ({
			serviceCodeId,
			onVan,
			par: parMap[serviceCodeId] ?? null,
		}),
	)
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
				name: v.installer?.name ?? v.name,
				belowPar,
				owedBack: view.owedBack.length,
				lastCompletionAt: last?.createdAt ?? null,
			}
		}),
	)
}
