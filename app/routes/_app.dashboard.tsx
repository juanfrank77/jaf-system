import { DashboardView } from "~/components/dashboard-view"
import { computeDashboardStats } from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.dashboard"

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	const docs = await db.jafInvoice.findMany({
		where:
			user.role === "SUPERVISOR"
				? { supervisorId: user.id }
				: user.role === "CREW"
					? { assignedCrewIds: { has: user.id } }
					: {}, // WAREHOUSE, FINANCE, ADMIN see all
		orderBy: { createdAt: "desc" },
		take: 20,
	})

	const { stats, alert } = computeDashboardStats(user.role, docs)

	return { stats, alert, docs }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const { stats, alert, docs } = loaderData
	return <DashboardView stats={stats} alert={alert} docs={docs} />
}
