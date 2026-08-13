import { useEffect } from "react"
import { redirect } from "react-router"
import { DashboardView } from "~/components/dashboard-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { computeDashboardStats } from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { cacheJobs } from "~/lib/offline-store"
import { requireSession } from "~/lib/permissions.server"
import type { DocStatus, Role } from "../../generated/prisma/client"
import { Prisma } from "../../generated/prisma/client"
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

	if (user.role === "COMPTROLLER") throw redirect("/comptroller")

	const url = new URL(request.url)
	const statusFilter = url.searchParams.get("status")
	const crewFilter = url.searchParams.get("crew")
	const searchFilter = url.searchParams.get("search")?.trim() || ""

	const selectedStatus = statusFilter ? (statusFilter as DocStatus) : null
	const selectedCrew = crewFilter || null

	const crewOptions = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		take: 100,
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
			? ((await db.$queryRaw`
				SELECT id, "controlNumber", status, "jobType", "jobAddressEstimated", "createdAt", "sendBackHistory"
				FROM jaf_invoice
				WHERE "supervisorId" = ${user.id}
					AND status = 'SIGNED'
					AND jsonb_array_length("sendBackHistory") > 0
				ORDER BY "createdAt" DESC
				LIMIT 50
			`) as any[])
			: []

	const warehousePreppedDocs =
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: { ...buildBaseWhere(user.role, user.id), status: "PREPPED" },
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const warehouseMissingDocs =
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: {
						...buildBaseWhere(user.role, user.id),
						status: "CREATED",
						prepChangedSincePrep: true,
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const warehouseReturnsDocs =
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: {
						...buildBaseWhere(user.role, user.id),
						status: { in: ["SIGNED", "FIELD_UPDATED"] },
						materialsReturned: { equals: Prisma.DbNull },
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const crewPreppedDocs =
		user.role === "CREW"
			? await db.jafInvoice.findMany({
					where: {
						...buildBaseWhere(user.role, user.id),
						status: "PREPPED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const crewInFieldDocs =
		user.role === "CREW"
			? ((await db.$queryRaw`
				SELECT id, "controlNumber", status, "jobType", "jobAddressEstimated", "createdAt", "sendBackHistory"
				FROM jaf_invoice
				WHERE "assignedCrewIds" @> ARRAY[${user.id}]::text[]
					AND status = 'SIGNED'
					AND ("sendBackHistory" IS NULL OR jsonb_array_length("sendBackHistory") = 0)
				ORDER BY "createdAt" DESC
				LIMIT 50
			`) as any[])
			: []

	const crewSentBackDocs =
		user.role === "CREW"
			? ((await db.$queryRaw`
				SELECT id, "controlNumber", status, "jobType", "jobAddressEstimated", "createdAt", "sendBackHistory"
				FROM jaf_invoice
				WHERE "assignedCrewIds" @> ARRAY[${user.id}]::text[]
					AND status = 'SIGNED'
					AND jsonb_array_length("sendBackHistory") > 0
				ORDER BY "createdAt" DESC
				LIMIT 50
			`) as any[])
			: []

	const crewSubmittedDocs =
		user.role === "CREW"
			? await db.jafInvoice.findMany({
					where: {
						...buildBaseWhere(user.role, user.id),
						status: "FIELD_UPDATED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const restockRequests =
		user.role === "WAREHOUSE"
			? await db.vanRestockRequest.findMany({
					where: { status: "REQUESTED" },
					include: { requestedBy: true, warehouse: true },
					orderBy: { createdAt: "desc" },
					take: 50,
				})
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
		warehousePreppedDocs,
		warehouseMissingDocs,
		warehouseReturnsDocs,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
		restockRequests,
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
		warehousePreppedDocs,
		warehouseMissingDocs,
		warehouseReturnsDocs,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
		restockRequests,
	} = loaderData

	useEffect(() => {
		if (typeof window === "undefined") return
		const allDocs = [
			...docs,
			...crewPreppedDocs,
			...crewInFieldDocs,
			...crewSentBackDocs,
			...crewSubmittedDocs,
		]
		cacheJobs(
			allDocs.map((d) => ({
				id: d.id,
				controlNumber: d.controlNumber,
				status: d.status,
				jobType: d.jobType,
				jobAddressEstimated: d.jobAddressEstimated,
				assignedCrewIds: d.assignedCrewIds || [],
				sendBackHistory: d.sendBackHistory,
				avisoNumber: d.avisoNumber,
				updatedAt: new Date().toISOString(),
			})),
		).catch(() => {})
	}, [
		docs,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
	])

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
			warehousePreppedDocs={warehousePreppedDocs}
			warehouseMissingDocs={warehouseMissingDocs}
			warehouseReturnsDocs={warehouseReturnsDocs}
			crewPreppedDocs={crewPreppedDocs}
			crewInFieldDocs={crewInFieldDocs}
			crewSentBackDocs={crewSentBackDocs}
			crewSubmittedDocs={crewSubmittedDocs}
			restockRequests={restockRequests}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
