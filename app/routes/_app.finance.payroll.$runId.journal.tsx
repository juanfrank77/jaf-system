import { db } from "~/lib/db.server"
import { buildJournalBlocks, RUN_INVOICES } from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll.$runId.journal"

/**
 * Production Journal PDF for a run. A resource route (loader, no component):
 * a raw PDF `Response` returned from a page route's action is read back by
 * React Router as data, so the download button there did nothing.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "COMPTROLLER", "ADMIN"])
	const run = await db.payrollRun.findUniqueOrThrow({
		where: { id: params.runId },
		include: { invoices: RUN_INVOICES },
	})
	const blocks = buildJournalBlocks(run.invoices)
	const bytes = await generateProductionJournalPdf(run, blocks)
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="journal-${run.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`,
		},
	})
}
