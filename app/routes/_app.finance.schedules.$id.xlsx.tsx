import fs from "node:fs/promises"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.schedules.$id.xlsx"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "COMPTROLLER", "ADMIN"])
	const s = await db.bankSchedule.findUnique({
		where: { id: params.id },
		select: { number: true, xlsxPath: true },
	})
	if (!s?.xlsxPath) throw new Response("Not found", { status: 404 })
	const bytes = await fs.readFile(s.xlsxPath).catch(() => null)
	if (!bytes) throw new Response("Not found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type":
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="schedule-${s.number}.xlsx"`,
		},
	})
}
