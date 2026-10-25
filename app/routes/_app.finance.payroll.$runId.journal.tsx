import { db } from "~/lib/db.server"
import { buildJournalBlocks, RUN_INVOICES } from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import { getBankInvoicePrefix } from "~/lib/system-settings.server"
import type { Route } from "./+types/_app.finance.payroll.$runId.journal"

/**
 * The payroll request sheet as a PDF. A resource route (loader, no component):
 * a raw PDF `Response` returned from a page route's action is read back by
 * React Router as data, so the download button there did nothing. Carmen can
 * only fetch a request that has been sent to her.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, [
		"FINANCE",
		"COMPTROLLER",
		"ADMIN",
	])
	const run = await db.payrollRun.findUniqueOrThrow({
		where: { id: params.runId },
		include: { invoices: RUN_INVOICES },
	})
	if (user.role === "COMPTROLLER" && !run.sentAt) {
		throw new Response("Not Found", { status: 404 })
	}
	// Carmen's copy goes to the brigades, so JAF's prices stay off it (D1).
	const bytes = await generateProductionJournalPdf(
		run,
		buildJournalBlocks(run.invoices),
		{
			showPrices: user.role !== "COMPTROLLER",
			invoicePrefix: await getBankInvoicePrefix(),
		},
	)
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="payroll-request-${run.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`,
		},
	})
}
