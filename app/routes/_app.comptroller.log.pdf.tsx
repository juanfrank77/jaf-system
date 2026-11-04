import { buildLogReport } from "~/lib/log.server"
import { logFileName } from "~/lib/log-view"
import { generateLogPdf } from "~/lib/pdf/log-report.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.log.pdf"

/** Print (inline) or Download (attachment) of exactly the view in the URL. */
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const r = await buildLogReport(request)
	const bytes = await generateLogPdf(
		r.result,
		{
			title: r.title,
			printedBy: user.name,
			printedAt: new Date(),
			filters: r.filters,
		},
		r.view.group !== "none",
	)
	const download = new URL(request.url).searchParams.get("download") === "1"
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `${download ? "attachment" : "inline"}; filename="${logFileName(r.tab, r.view, "pdf")}"`,
		},
	})
}
