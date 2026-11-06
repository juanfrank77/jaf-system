import fs from "node:fs/promises"
import { invoiceFile } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.claro.$id.invoice"

/** The invoice made from this PO, as the PDF Lissette files in Ariba. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const inv = await db.claroInvoice.findUnique({
		where: { claroPoId: params.id },
		select: { id: true },
	})
	const f = inv ? await invoiceFile(inv.id) : null
	const bytes = f ? await fs.readFile(f.path).catch(() => null) : null
	if (!f || !bytes) throw new Response("Not Found", { status: 404 })
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"X-Content-Type-Options": "nosniff",
			"Content-Disposition": `attachment; filename="${f.name}"`,
		},
	})
}
