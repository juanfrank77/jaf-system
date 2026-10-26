import fs from "node:fs/promises"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.installers.batches.$id.xlsx"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const batch = await db.ewitBatch.findUnique({ where: { id: params.id } })
	if (!batch?.xlsxPath) throw new Response("Not Found", { status: 404 })
	const bytes = await fs.readFile(batch.xlsxPath).catch(() => null)
	if (!bytes) throw new Response("Not Found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type":
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="JAF_Installers_PBCC_${batch.number}.xlsx"`,
		},
	})
}
