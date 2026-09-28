import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/api.warehouse-stock-trail"

// Backs the stock screen's per-code movement trail (MovementTrail component).
//
// Two different "job" references land on bulk warehouse movements:
//  - `refDocId` → the JAF doc's `controlNumber`. This is what the warehouse
//    RELEASE/RETURN rows written by this branch actually carry.
//  - `refCompletionId` → an installer job's `claroOrderNo` (InstallCompletion).
//    Only van-scoped SERIAL movements set it, but it is resolved too so the
//    column keeps working if a bulk row ever carries one.
// Resolving only the latter meant every warehouse row fell through to its note
// and the job column was permanently empty. Other movement types (RECEIVE,
// ADJUST, STARTING_BALANCE, …) genuinely have no job and still fall back.
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const url = new URL(request.url)
	const warehouseId = url.searchParams.get("warehouseId") ?? ""
	const serviceCodeId = url.searchParams.get("serviceCodeId") ?? ""
	if (!warehouseId || !serviceCodeId) return Response.json({ trail: [] })

	const movements = await db.stockMovement.findMany({
		where: { kind: "BULK", warehouseId, serviceCodeId },
		orderBy: { at: "desc" },
		take: 50,
		include: { byUser: { select: { name: true } } },
	})
	const completionIds = [
		...new Set(
			movements
				.map((m) => m.refCompletionId)
				.filter((id): id is string => Boolean(id)),
		),
	]
	const completions = completionIds.length
		? await db.installCompletion.findMany({
				where: { id: { in: completionIds } },
				select: { id: true, claroOrderNo: true },
			})
		: []
	const jobByCompletionId = new Map(
		completions.map((c) => [c.id, c.claroOrderNo]),
	)

	const docIds = [
		...new Set(
			movements
				.map((m) => m.refDocId)
				.filter((id): id is string => Boolean(id)),
		),
	]
	const docs = docIds.length
		? await db.jafInvoice.findMany({
				where: { id: { in: docIds } },
				select: { id: true, controlNumber: true },
			})
		: []
	const jobByDocId = new Map(docs.map((d) => [d.id, d.controlNumber]))

	return Response.json({
		trail: movements.map((m) => ({
			id: m.id,
			type: m.type,
			qty: m.qty,
			at: m.at,
			actor: m.byUser.name,
			note: m.note,
			job:
				(m.refDocId ? (jobByDocId.get(m.refDocId) ?? null) : null) ??
				(m.refCompletionId
					? (jobByCompletionId.get(m.refCompletionId) ?? null)
					: null),
		})),
	})
}
