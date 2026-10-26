import { db } from "~/lib/db.server"
import { buildJournalBlocks, RUN_INVOICES } from "~/lib/payroll-run.server"
import {
	generatePacketSummaryPdf,
	generateProductionJournalPdf,
	journalOutline,
} from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import { getBankInvoicePrefix } from "~/lib/system-settings.server"
import type { Route } from "./+types/_app.finance.payroll.$runId.journal"

/**
 * The payroll request sheet as a PDF. A resource route (loader, no component):
 * a raw PDF `Response` returned from a page route's action is read back by
 * React Router as data, so the download button there did nothing. Carmen can
 * only fetch a request that has been sent to her.
 *
 * `?mode=whole` (default) | `brigades&brigades=009,011` | `summary`, and
 * `?inline=1` to show it in the viewer or the print frame instead of saving it.
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
	const url = new URL(request.url)
	const mode = url.searchParams.get("mode") ?? "whole"
	const inline = url.searchParams.get("inline") === "1"
	const blocks = buildJournalBlocks(run.invoices)
	const forCarmen = user.role === "COMPTROLLER"
	const opts = {
		// Carmen's copy goes to the brigades, so JAF's prices stay off it (D1).
		showPrices: !forCarmen,
		invoicePrefix: await getBankInvoicePrefix(),
		footer: forCarmen
			? `Carmen's copy \u00b7 sent by Lissette ${sentLabel(run.sentAt)}`
			: undefined,
	}
	let bytes: Buffer
	if (mode === "summary") {
		bytes = await generatePacketSummaryPdf(
			run,
			await journalOutline(run, blocks, opts),
			opts,
		)
	} else if (mode === "brigades") {
		const wanted = (url.searchParams.get("brigades") ?? "")
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean)
		if (wanted.length === 0)
			throw new Response("Pick at least one brigade", { status: 400 })
		bytes = await generateProductionJournalPdf(run, blocks, {
			...opts,
			onlyBrigades: wanted,
		})
	} else {
		bytes = await generateProductionJournalPdf(run, blocks, opts)
	}
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `${inline ? "inline" : "attachment"}; filename="payroll-request-${run.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`,
		},
	})
}

function sentLabel(sentAt: Date | null): string {
	if (!sentAt) return ""
	return sentAt
		.toLocaleString("en-US", {
			timeZone: "America/Puerto_Rico",
			month: "2-digit",
			day: "2-digit",
			year: "2-digit",
			hour: "numeric",
			minute: "2-digit",
		})
		.replace(",", "")
}
