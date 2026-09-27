import { useEffect } from "react"
import { redirect } from "react-router"
import { DashboardView } from "~/components/dashboard-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { SupervisorDashboard } from "~/components/supervisor-dashboard"
import {
	computeDashboardStats,
	type DashboardExplainer,
} from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import {
	isComptrollerEnabled,
	isDashboardFiltersEnabled,
} from "~/lib/features.server"
import { cacheJobs } from "~/lib/offline-store"
import { requireSession } from "~/lib/permissions.server"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	type SupervisorStage,
} from "~/lib/supervisor-stage"
import { getAvisoAmountTolerance } from "~/lib/system-settings.server"
import { toNumberPrice } from "~/lib/utils"
import type { DocStatus, Role } from "../../generated/prisma/client"
import { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.dashboard"

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — JAF Ops" }]

type SendBackHistoryRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
	sendBackHistory: unknown
}

async function buildBaseWhere(
	role: Role,
	userId: string,
): Promise<Record<string, unknown>> {
	if (role === "SUPERVISOR") {
		const areas = await supervisorAreas(db, userId)
		return ownedOrInArea(userId, areas)
	}
	if (role === "CREW") return { assignedCrewIds: { has: userId } }
	return {} // WAREHOUSE, FINANCE, ADMIN see all
}

type QueueRow = {
	id: string
	controlNumber: string
	jobAddressEstimated: string
	jobAddressActual: string | null
	brigadeName: string | null
	stage: SupervisorStage
	amount: number | null
	note?: string | null
}

const queueSelect = {
	id: true,
	controlNumber: true,
	status: true,
	jobType: true,
	jobAddressEstimated: true,
	jobAddressActual: true,
	createdAt: true,
	supervisorApprovedAt: true,
	jafInvoiceGeneratedAt: true,
	jafInvoiceLineTotal: true,
	avisoLineTotal: true,
	avisoMatchedAt: true,
	releasedToFinanceAt: true,
	sendBackHistory: true,
	brigade: { select: { name: true } },
} as const

function toRow(
	d: {
		id: string
		controlNumber: string
		jobAddressEstimated: string
		jobAddressActual?: string | null
		jafInvoiceLineTotal?: unknown
		brigade?: { name: string } | null
	},
	stage: SupervisorStage,
	note?: string | null,
): QueueRow {
	return {
		id: d.id,
		controlNumber: d.controlNumber,
		jobAddressEstimated: d.jobAddressEstimated,
		jobAddressActual: d.jobAddressActual ?? null,
		brigadeName: d.brigade?.name ?? null,
		stage,
		amount:
			d.jafInvoiceLineTotal == null
				? null
				: toNumberPrice(d.jafInvoiceLineTotal),
		note,
	}
}

type SendBackHistoryEntry = { note?: string }

async function loadSupervisorQueues(userId: string) {
	const tolerance = await getAvisoAmountTolerance()
	const areas = await supervisorAreas(db, userId)
	const scope = ownedOrInArea(userId, areas)
	const [pending, sentBackRaw, approved] = await Promise.all([
		db.jafInvoice.findMany({
			where: { ...scope, status: "FIELD_UPDATED" },
			select: queueSelect,
			orderBy: { fieldSubmittedAt: "desc" },
			take: 50,
		}),
		db.$queryRaw`
			SELECT ji.id, ji."controlNumber", ji."jobAddressEstimated", ji."jobAddressActual", ji."sendBackHistory"
			FROM jaf_invoice ji
			LEFT JOIN "Brigade" b ON b.id = ji."brigadeId"
			WHERE (ji."supervisorId" = ${userId} OR b.area = ANY(${areas}))
				AND ji.status = 'SIGNED' AND jsonb_array_length(ji."sendBackHistory") > 0
			ORDER BY ji."createdAt" DESC LIMIT 50` as Promise<
			{
				id: string
				controlNumber: string
				jobAddressEstimated: string
				jobAddressActual: string | null
				sendBackHistory: unknown
			}[]
		>,
		db.jafInvoice.findMany({
			where: {
				...scope,
				supervisorApprovedAt: { not: null },
				releasedToFinanceAt: null,
				status: { not: "CANCELLED" },
			},
			select: queueSelect,
			orderBy: { supervisorApprovedAt: "asc" },
			take: 100,
		}),
	])
	const pendingReview = pending.map((d) => toRow(d, "APPROVE"))
	const sentBack = sentBackRaw.map((d) => {
		const h = Array.isArray(d.sendBackHistory)
			? (d.sendBackHistory as SendBackHistoryEntry[])
			: []
		return toRow(d, "FIELD", h.at(-1)?.note ?? null)
	})
	const missingAviso: QueueRow[] = []
	const blocked: QueueRow[] = []
	for (const d of approved) {
		const stage = deriveSupervisorStage(d, null)
		if (d.avisoMatchedAt) continue
		if (d.avisoLineTotal == null) missingAviso.push(toRow(d, stage))
		else if (
			Math.abs(
				toNumberPrice(d.avisoLineTotal) - toNumberPrice(d.jafInvoiceLineTotal),
			) > tolerance
		)
			blocked.push(toRow(d, "AVISO"))
	}
	return { pendingReview, sentBack, missingAviso, blocked }
}

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	if (user.role === "COMPTROLLER") {
		throw redirect(isComptrollerEnabled() ? "/comptroller" : "/dashboard")
	}

	const url = new URL(request.url)
	const statusFilter = url.searchParams.get("status")
	const crewFilter = url.searchParams.get("crew")
	const jobTypeFilter = url.searchParams.get("jobType")
	const searchFilter = url.searchParams.get("search")?.trim() || ""

	const selectedStatus = statusFilter ? (statusFilter as DocStatus) : null
	const selectedCrew = crewFilter || null
	const selectedJobType = jobTypeFilter || null

	const crewOptions = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		take: 100,
		select: { id: true, name: true },
	})

	const jobTypeOptions = await db.jafInvoice.findMany({
		select: { jobType: true },
		distinct: ["jobType"],
		orderBy: { jobType: "asc" },
	})

	const baseWhere = await buildBaseWhere(user.role, user.id)
	const where: Record<string, unknown> = { ...baseWhere }

	if (selectedStatus) {
		where.status = selectedStatus
	}
	if (selectedCrew && user.role === "SUPERVISOR") {
		where.assignedCrewIds = { has: selectedCrew }
	}
	if (selectedJobType) {
		where.jobType = selectedJobType
	}
	if (searchFilter) {
		const searchOr = [
			{ avisoNumber: { contains: searchFilter, mode: "insensitive" } },
			{ jobAddressEstimated: { contains: searchFilter, mode: "insensitive" } },
		]
		if (where.OR) {
			// baseWhere already used `OR` for area-scoping (SUPERVISOR's
			// ownedOrInArea) — nest both under `AND` so the search narrows the
			// scope instead of silently replacing/dropping it.
			where.AND = [{ OR: where.OR }, { OR: searchOr }]
			delete where.OR
		} else {
			where.OR = searchOr
		}
	}

	const docs = await db.jafInvoice.findMany({
		where,
		orderBy: { createdAt: "desc" },
		take: 50,
	})

	// LC_REQUEST_GENERATED is Finance/Admin-only in all projections.
	const visibleDocs =
		user.role === "FINANCE" || user.role === "ADMIN"
			? docs
			: docs.filter((d) => d.status !== "LC_REQUEST_GENERATED")

	const { stats, alert, explainer } =
		user.role === "SUPERVISOR"
			? { stats: [], alert: null, explainer: null }
			: computeDashboardStats(user.role, visibleDocs)

	const supervisorQueues =
		user.role === "SUPERVISOR" ? await loadSupervisorQueues(user.id) : null

	const warehousePreppedDocs =
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: "PREPPED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	const warehouseMissingDocs =
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: { in: ["CREATED", "PREPPED"] },
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
						...(await buildBaseWhere(user.role, user.id)),
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
						...(await buildBaseWhere(user.role, user.id)),
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
		`) as SendBackHistoryRow[])
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
		`) as SendBackHistoryRow[])
			: []

	const crewSubmittedDocs =
		user.role === "CREW"
			? await db.jafInvoice.findMany({
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: "FIELD_UPDATED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: []

	return {
		stats,
		alert,
		explainer,
		docs: visibleDocs,
		pendingReviewDocs: [],
		sentBackDocs: [],
		supervisorQueues,
		showFilters: isDashboardFiltersEnabled(),
		crewOptions,
		jobTypeOptions: jobTypeOptions
			.map((o) => o.jobType)
			.filter(Boolean) as string[],
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
		warehousePreppedDocs,
		warehouseMissingDocs,
		warehouseReturnsDocs,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
	}
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const {
		stats,
		alert,
		docs,
		pendingReviewDocs,
		sentBackDocs,
		supervisorQueues,
		showFilters,
		crewOptions,
		jobTypeOptions,
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
		warehousePreppedDocs,
		warehouseMissingDocs,
		warehouseReturnsDocs,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
	} = loaderData
	const explainer = (loaderData as { explainer?: DashboardExplainer })
		.explainer as DashboardExplainer

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
				assignedCrewIds: "assignedCrewIds" in d ? d.assignedCrewIds : [],
				sendBackHistory: "sendBackHistory" in d ? d.sendBackHistory : undefined,
				avisoNumber: "avisoNumber" in d ? d.avisoNumber : null,
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

	if (supervisorQueues) {
		return <SupervisorDashboard queues={supervisorQueues} />
	}

	return (
		<DashboardView
			stats={stats}
			alert={alert}
			explainer={explainer}
			docs={docs}
			showFilters={showFilters}
			pendingReviewDocs={pendingReviewDocs}
			sentBackDocs={sentBackDocs}
			crewOptions={crewOptions}
			jobTypeOptions={jobTypeOptions}
			selectedStatus={selectedStatus}
			selectedCrew={selectedCrew}
			selectedJobType={selectedJobType}
			searchFilter={searchFilter}
			warehousePreppedDocs={warehousePreppedDocs}
			warehouseMissingDocs={warehouseMissingDocs}
			warehouseReturnsDocs={warehouseReturnsDocs}
			crewPreppedDocs={crewPreppedDocs}
			crewInFieldDocs={crewInFieldDocs}
			crewSentBackDocs={crewSentBackDocs}
			crewSubmittedDocs={crewSubmittedDocs}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
