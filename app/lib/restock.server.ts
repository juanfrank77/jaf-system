import { db } from "./db.server"
import { getVanView } from "./van-view.server"

export async function buildRestockPrefill(
	vanId: string,
): Promise<{ serviceCodeId: string; qty: number }[]> {
	const view = await getVanView(vanId)
	return [...view.serialized, ...view.accessories]
		.filter((r) => r.par != null)
		.map((r) => ({
			serviceCodeId: r.serviceCodeId,
			qty: Math.max((r.par as number) - r.onVan, 0),
		}))
		.filter((l) => l.qty > 0)
}

export async function createRestock(
	vanId: string,
	lines: { serviceCodeId: string; qty: number }[],
	_actor: { id: string },
) {
	const pars = Object.fromEntries(
		(await db.vanPar.findMany({ where: { vanId } })).map((p) => [
			p.serviceCodeId,
			p.parQty,
		]),
	)
	const view = await getVanView(vanId)
	const onVan = Object.fromEntries(
		[...view.serialized, ...view.accessories].map((r) => [
			r.serviceCodeId,
			r.onVan,
		]),
	)
	const overPar = lines.some((l) => {
		const par = pars[l.serviceCodeId]
		return par != null && l.qty + (onVan[l.serviceCodeId] ?? 0) > par
	})
	const status = overPar ? "NEEDS_SIGNOFF" : "SUBMITTED"
	const req = await db.restockRequest.create({ data: { vanId, lines, status } })
	if (overPar) {
		const supers = await db.user.findMany({
			where: { role: { in: ["INSTALLER_SUPERVISOR", "ADMIN"] }, active: true },
			select: { id: true },
		})
		await db.$transaction(
			supers.map((s) =>
				db.notification.create({
					data: {
						userId: s.id,
						message: `Restock ${req.id.slice(-6)} needs over-par sign-off.`,
					},
				}),
			),
		)
	}
	return { id: req.id, status: req.status }
}
