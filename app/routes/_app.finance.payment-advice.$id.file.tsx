import fs from "node:fs/promises"
import { adviceFile } from "~/lib/payment-advice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payment-advice.$id.file"

/** The uploaded advice as Claro sent it. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const f = await adviceFile(params.id)
	const bytes = f ? await fs.readFile(f.filePath).catch(() => null) : null
	if (!f || !bytes) throw new Response("Not Found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": "inline",
		},
	})
}
