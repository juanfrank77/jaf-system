import { DashboardView } from "~/components/dashboard-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { computeDashboardStats } from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { DocStatus, Role } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.dashboard"

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — JAF Ops" }]

function buildBaseWhere(role: Role, userId: string): Record<string, unknown> {
	if (role === "SUPERVISOR") return { supervisorId: userId }
	if (role === "CREW") return { assignedCrewIds: { has: userId } }
	return {} // WAREHOUSE, FINANCE, ADMIN see all
}

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	const url = new URL(request.url)
	const statusFilter = url.searchParams.get("status")
	const crewFilter = url.searchParams.get("crew")
	const searchFilter = url.searchParams.get("search")?.trim() || ""

	const selectedStatus = statusFilter ? (statusFilter as DocStatus) : null
	const selectedCrew = crewFilter || null

	const crewOptions = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		select: { id: true, name: true },
	})

	const baseWhere = buildBaseWhere(user.role, user.id)
	const where: Record<string, unknown> = { ...baseWhere }

	if (selectedStatus) {
		where.status = selectedStatus
	}
	if (selectedCrew && user.role === "SUPERVISOR") {
		where.assignedCrewIds = { has: selectedCrew }
	}
	if (searchFilter) {
		where.OR = [
			{ avisoNumber: { contains: searchFilter, mode: "insensitive" } },
			{ jobAddressEstimated: { contains: searchFilter, mode: "insensitive" } },
		]
	}

	const docs = await db.jafInvoice.findMany({
		where,
		orderBy: { createdAt: "desc" },
		take: 50,
	})

	const { stats, alert } = computeDashboardStats(user.role, docs)

	const pendingReviewDocs =
		user.role === "SUPERVISOR"
			? await db.jafInvoice.findMany({
					where: {
						...buildBaseWhere(user.role, user.id),
						status: "FIELD_UPDATED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const sentBackDocs =
		user.role === "SUPERVISOR"
			? await db.jafInvoice
					.findMany({
						where: {
							...buildBaseWhere(user.role, user.id),
							status: "SIGNED",
						},
						orderBy: { createdAt: "desc" },
						take: 50,
					})
					.then((allSigned) =>
						allSigned.filter(
							(d) =>
								Array.isArray(d.sendBackHistory) &&
								d.sendBackHistory.length > 0,
						),
					)
			: []

	return {
		stats,
		alert,
		docs,
		pendingReviewDocs,
		sentBackDocs,
		crewOptions,
		selectedStatus,
		selectedCrew,
		searchFilter,
	}
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const {
		stats,
		alert,
		docs,
		pendingReviewDocs,
		sentBackDocs,
		crewOptions,
		selectedStatus,
		selectedCrew,
		searchFilter,
	} = loaderData
	return (
		<DashboardView
			stats={stats}
			alert={alert}
			docs={docs}
			pendingReviewDocs={pendingReviewDocs}
			sentBackDocs={sentBackDocs}
			crewOptions={crewOptions}
			selectedStatus={selectedStatus}
			selectedCrew={selectedCrew}
			searchFilter={searchFilter}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
