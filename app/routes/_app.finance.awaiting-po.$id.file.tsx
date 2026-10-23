import fs from "node:fs/promises"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-po.$id.file"

/** The uploaded PO, shown beside its fields. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const po = await db.claroPo.findUnique({
		where: { id: params.id },
		select: { filePath: true },
	})
	if (!po) throw new Response("Not Found", { status: 404 })
	const bytes = await fs.readFile(po.filePath).catch(() => null)
	if (!bytes) throw new Response("Not Found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": "inline",
		},
	})
}
