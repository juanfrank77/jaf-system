import { ledgerSummaries } from "~/lib/aviso-ledger.server"
import { parseRange } from "~/lib/ledger-range"
import { generateLedgerXlsx } from "~/lib/ledger-xlsx.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.ledger.export"

/** The Ledger as Excel for the chosen range. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const { from, to, fromDate, toDate } = parseRange(
		url.searchParams.get("from"),
		url.searchParams.get("to"),
	)
	const xlsx = await generateLedgerXlsx(await ledgerSummaries(fromDate, toDate))
	return new Response(new Uint8Array(xlsx), {
		headers: {
			"Content-Type":
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="ledger-${from}-to-${to}.xlsx"`,
		},
	})
}
