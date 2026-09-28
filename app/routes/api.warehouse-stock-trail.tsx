import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/api.warehouse-stock-trail"

// Backs the stock screen's per-code movement trail (MovementTrail component).
// Resolves `refCompletionId` to the crew job's `claroOrderNo` — this app's
// existing "job" identifier (see InstallCompletion) — for RELEASE/RETURN
// rows; other movement types (RECEIVE, ADJUST, STARTING_BALANCE, …) have no
// job and fall back to their reason note.
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

	return Response.json({
		trail: movements.map((m) => ({
			id: m.id,
			type: m.type,
			qty: m.qty,
			at: m.at,
			actor: m.byUser.name,
			note: m.note,
			job: m.refCompletionId
				? (jobByCompletionId.get(m.refCompletionId) ?? null)
				: null,
		})),
	})
}
