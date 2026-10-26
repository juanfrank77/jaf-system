import { db } from "~/lib/db.server"
import { buildJournalBlocks, RUN_INVOICES } from "~/lib/payroll-run.server"
import { journalOutline } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll.$runId.journal.outline"

/** Where each brigade starts in the packet: feeds the viewer's jump list and the print choices. */
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
	return journalOutline(run, buildJournalBlocks(run.invoices), {
		showPrices: false,
	})
}
