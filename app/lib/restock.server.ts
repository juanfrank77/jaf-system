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

// A per-line ceiling well above any real van's par level. Without it, a
// crafted quantity reaches Array.from({ length: qty }, ...) calls in the
// release UI (server-rendered) and can OOM/hang the app process.
const MAX_LINE_QTY = 1000

export async function createRestock(
	vanId: string,
	lines: { serviceCodeId: string; qty: number }[],
	_actor: { id: string },
) {
	if (lines.length === 0) {
		throw new Error("A restock must have at least one line")
	}
	for (const l of lines) {
		if (!Number.isInteger(l.qty) || l.qty <= 0 || l.qty > MAX_LINE_QTY) {
			throw new Error(
				`Invalid quantity ${l.qty} for service code ${l.serviceCodeId}`,
			)
		}
	}
	// Coalesce duplicate lines for the same service code before evaluating
	// over-par: per-line evaluation would let a split quantity (e.g. two
	// lines of 6 against a par of 6) slip past the gate that a single
	// combined line of 12 would correctly trip.
	const coalesced = new Map<string, number>()
	for (const l of lines) {
		coalesced.set(
			l.serviceCodeId,
			(coalesced.get(l.serviceCodeId) ?? 0) + l.qty,
		)
	}
	const mergedLines = [...coalesced.entries()].map(([serviceCodeId, qty]) => ({
		serviceCodeId,
		qty,
	}))
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
	const overPar = mergedLines.some((l) => {
		const par = pars[l.serviceCodeId]
		return par != null && l.qty + (onVan[l.serviceCodeId] ?? 0) > par
	})
	const status = overPar ? "NEEDS_SIGNOFF" : "SUBMITTED"
	const req = await db.restockRequest.create({
		data: { vanId, lines: mergedLines, status },
	})
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
