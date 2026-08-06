import { DashboardView } from "~/components/dashboard-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
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

	const pendingReviewDocs =
		user.role === "SUPERVISOR"
			? await db.jafInvoice.findMany({
					where: {
						supervisorId: user.id,
						status: "FIELD_UPDATED",
					},
					orderBy: { createdAt: "desc" },
					take: 20,
				})
			: []

	return { stats, alert, docs, pendingReviewDocs }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const { stats, alert, docs, pendingReviewDocs } = loaderData
	return (
		<DashboardView
			stats={stats}
			alert={alert}
			docs={docs}
			pendingReviewDocs={pendingReviewDocs}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
