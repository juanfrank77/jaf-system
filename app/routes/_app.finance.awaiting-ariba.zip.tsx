import { zipInvoices } from "~/lib/claro-invoice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-ariba.zip"

/** The ticked invoices' PDFs in one zip, for loading in Ariba. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const ids = new URL(request.url).searchParams.getAll("id")
	if (ids.length === 0) throw new Response("Bad Request", { status: 400 })
	const zip = await zipInvoices(ids)
	return new Response(new Uint8Array(zip), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": 'attachment; filename="claro-invoices.zip"',
		},
	})
}
