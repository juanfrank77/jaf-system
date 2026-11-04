import fs from "node:fs/promises"
import { invoiceFile } from "~/lib/claro-invoice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-ariba.$id.file"

/** One made invoice, as the PDF Lissette loads in Ariba. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const f = await invoiceFile(params.id)
	const bytes = f ? await fs.readFile(f.path).catch(() => null) : null
	if (!f || !bytes) throw new Response("Not Found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `inline; filename="${f.name}"`,
		},
	})
}
