import fs from "node:fs/promises"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.pbcc.$id.invoice"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "COMPTROLLER", "ADMIN"])
	const doc = await db.jafInvoice.findUnique({
		where: { id: params.id },
		select: { controlNumber: true, bankInvoicePdfPath: true },
	})
	if (!doc?.bankInvoicePdfPath) throw new Response("Not found", { status: 404 })
	const bytes = await fs.readFile(doc.bankInvoicePdfPath).catch(() => null)
	if (!bytes) throw new Response("Not found", { status: 404 })
	const safeName = doc.controlNumber.replace(/[^A-Za-z0-9._-]/g, "_")
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${safeName}-bank-invoice.pdf"`,
		},
	})
}
