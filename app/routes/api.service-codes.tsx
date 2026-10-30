import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { isPriceBlind, searchServiceCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/api.service-codes"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const viewer = await db.user.findUnique({
		where: { id: session.user.id },
		select: { role: true },
	})
	// Crew accounts no longer sign in.
	if (viewer?.role === "CREW") return new Response("Forbidden", { status: 403 })
	// Fail closed: an unknown viewer gets no prices.
	const showPrices = viewer !== null && !isPriceBlind(viewer.role)
	const q = new URL(request.url).searchParams.get("q") ?? ""
	const [rows, total] = await Promise.all([
		searchServiceCodes(q, 25),
		db.serviceCode.count({ where: { active: true, kind: "SERVICE" } }),
	])
	return Response.json({
		total,
		results: rows.map((c) => ({
			id: c.id,
			claroCode: c.claroCode,
			name: c.name,
			accountCode: c.accountCode,
			unit: c.unit,
			equipment: c.equipment,
			...(showPrices ? { unitPrice: toNumberPrice(c.unitPrice) } : {}),
		})),
	})
}
