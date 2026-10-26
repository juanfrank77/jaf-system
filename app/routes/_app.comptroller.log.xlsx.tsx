import { buildLogReport } from "~/lib/log.server"
import { logFileName } from "~/lib/log-view"
import { generateLogXlsx } from "~/lib/pdf/log-report.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.log.xlsx"

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const r = await buildLogReport(request)
	const bytes = await generateLogXlsx(r.result, {
		title: r.title,
		printedBy: user.name,
		printedAt: new Date(),
		filters: r.filters,
	})
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type":
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="${logFileName(r.tab, r.view, "xlsx")}"`,
		},
	})
}
