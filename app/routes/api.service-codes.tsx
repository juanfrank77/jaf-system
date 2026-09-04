import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { searchServiceCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/api.service-codes"

export async function loader({ request }: Route.LoaderArgs) {
	await requireSession(request)
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
			unitPrice: toNumberPrice(c.unitPrice),
		})),
	})
}
