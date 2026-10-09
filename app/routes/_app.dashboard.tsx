import { useEffect } from "react"
import { redirect } from "react-router"
import { RoleDashboard } from "~/components/dashboards/role-dashboard"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	computeAwaitingPickup,
	computeDashboardStats,
	computeMaterialSignals,
	type DashboardExplainer,
} from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import {
	isComptrollerEnabled,
	isDashboardFiltersEnabled,
} from "~/lib/features.server"
import { cacheJobs } from "~/lib/offline-store"
import { pageTitle } from "~/lib/page-title"
import { requireSession } from "~/lib/permissions.server"
import {
	needsReviewCount,
	refurbishedCount,
	repairPoolCount,
} from "~/lib/serial-stock"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	type SupervisorStage,
} from "~/lib/supervisor-stage"
import { getAvisoAmountTolerance } from "~/lib/system-settings.server"
import { toNumberPrice } from "~/lib/utils"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { DocStatus, Role } from "../../generated/prisma/client"
import { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.dashboard"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.dashboard") },
]

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
	/** When the job entered this queue (submitted / returned / approved). */
	since: Date | null
	qtyDiscrepancy: boolean
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
	fieldSubmittedAt: true,
	estimatedMaterials: true,
	materialsTaken: true,
	materialsUsed: true,
	materialsReturned: true,
	brigade: { select: { name: true } },
} as const

function toRow(
	d: {
		id: string
		controlNumber: string
		jobAddressEstimated: string
		jobAddressActual?: string | null
		jafInvoiceLineTotal?: unknown
		estimatedMaterials?: unknown
		materialsTaken?: unknown
		materialsUsed?: unknown
		materialsReturned?: unknown
		brigade?: { name: string } | null
	},
	stage: SupervisorStage,
	since: Date | null,
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
		since,
		qtyDiscrepancy: computeMaterialSignals([d as never]).discrepancy > 0,
	}
}

/** Adds the derived current step to each row (RELEASE vs PRECERT needs the pre-cert signatures). */
async function withStages<
	T extends {
		id: string
		status: DocStatus
		supervisorApprovedAt: Date | null
		jafInvoiceGeneratedAt: Date | null
		avisoMatchedAt: Date | null
		releasedToFinanceAt: Date | null
	},
>(docs: T[]): Promise<(T & { stage: SupervisorStage })[]> {
	const sheets = await db.preCertSheet.findMany({
		where: { docId: { in: docs.map((d) => d.id) }, supersededAt: null },
		select: { docId: true, sigSupervisorAt: true, sigSubcontractorAt: true },
	})
	const byDoc = new Map(sheets.map((s) => [s.docId, s]))
	return docs.map((d) => ({
		...d,
		stage: deriveSupervisorStage(d, byDoc.get(d.id) ?? null),
	}))
}

type SendBackHistoryEntry = { note?: string; createdAt?: string }

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
	const pendingReview = pending.map((d) =>
		toRow(d, "APPROVE", d.fieldSubmittedAt),
	)
	const sentBack = sentBackRaw.map((d) => {
		const h = Array.isArray(d.sendBackHistory)
			? (d.sendBackHistory as SendBackHistoryEntry[])
			: []
		const returnedAt = h.at(-1)?.createdAt
		return toRow(
			d,
			"FIELD",
			returnedAt ? new Date(returnedAt) : null,
			h.at(-1)?.note ?? null,
		)
	})
	const approvedRows: QueueRow[] = []
	const missingAviso: QueueRow[] = []
	const blocked: QueueRow[] = []
	for (const d of approved) {
		const stage = deriveSupervisorStage(d, null)
		if (d.avisoMatchedAt) {
			approvedRows.push(toRow(d, stage, d.supervisorApprovedAt))
		} else if (d.avisoLineTotal == null) {
			missingAviso.push(toRow(d, stage, d.supervisorApprovedAt))
		} else if (
			Math.abs(
				toNumberPrice(d.avisoLineTotal) - toNumberPrice(d.jafInvoiceLineTotal),
			) > tolerance
		) {
			blocked.push(toRow(d, "AVISO", d.supervisorApprovedAt))
		} else {
			approvedRows.push(toRow(d, stage, d.supervisorApprovedAt))
		}
	}
	return {
		pendingReview,
		sentBack,
		approved: approvedRows,
		missingAviso,
		blocked,
	}
}

async function loadSupervisorScope(userId: string) {
	const areas = await supervisorAreas(db, userId)
	const brigadeCount = await db.brigade.count({
		where: { active: true, area: { in: areas } },
	})
	return { areas, brigadeCount }
}

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	// An installer's home is /installer. Only an installer with no profile
	// stays here, because /installer would send them straight back.
	if (user.role === "INSTALLER") {
		const profile = await db.installerProfile.findUnique({
			where: { userId: user.id },
			select: { id: true },
		})
		if (profile) throw redirect("/installer")
	}

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

	// The supervisor's tiles describe their whole scope, so a filter that
	// narrows the list must not also shrink the counts.
	const hasFilters =
		!!selectedStatus || !!selectedCrew || !!selectedJobType || !!searchFilter
	const statsDocs =
		user.role === "SUPERVISOR" && hasFilters
			? (
					await db.jafInvoice.findMany({
						where: baseWhere,
						orderBy: { createdAt: "desc" },
						take: 50,
					})
				).filter((d) => d.status !== "LC_REQUEST_GENERATED")
			: visibleDocs
	const { stats, alert, explainer } = computeDashboardStats(
		user.role,
		statsDocs,
	)

	const supervisorQueues =
		user.role === "SUPERVISOR" ? await loadSupervisorQueues(user.id) : null
	const supervisorScope =
		user.role === "SUPERVISOR" ? await loadSupervisorScope(user.id) : null

	// Awaiting-pickup aging (spec §6, "days staged … red past 3"): the PREPPED
	// queues are piped through computeAwaitingPickup so `aged`/`daysStaged`
	// actually reach the view — without this the badge can never render.
	const warehousePreppedDocs = computeAwaitingPickup(
		user.role === "WAREHOUSE"
			? await db.jafInvoice.findMany({
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: "PREPPED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: [],
	)

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

	const warehouseSerialCounts = await (async () => {
		if (user.role !== "WAREHOUSE")
			return { triage: 0, repairPool: 0, needsReview: 0, refurbished: 0 }
		// Follows the header warehouse switch (`wh` cookie) like every other
		// warehouse-scoped query, instead of pinning to the first assignment —
		// otherwise switching to warehouse B left these tiles counting A.
		const { selectedId } = await resolveWarehouseScope(db, request, user)
		if (!selectedId)
			return { triage: 0, repairPool: 0, needsReview: 0, refurbished: 0 }
		const [triage, repairPool, needsReview, refurbished] = await Promise.all([
			db.serialLocation.count({
				where: { status: "RETURNED", currentRef: selectedId },
			}),
			repairPoolCount(selectedId),
			needsReviewCount(selectedId),
			refurbishedCount(selectedId),
		])
		return { triage, repairPool, needsReview, refurbished }
	})()
	const warehouseTriageCount = warehouseSerialCounts.triage

	const crewPreppedDocs = computeAwaitingPickup(
		user.role === "CREW"
			? await db.jafInvoice.findMany({
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: "PREPPED",
					},
					orderBy: { createdAt: "desc" },
					take: 50,
				})
			: [],
	)

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
		role: user.role,
		stats,
		alert,
		explainer,
		docs: await withStages(visibleDocs),
		pendingReviewDocs: [],
		sentBackDocs: [],
		supervisorQueues,
		supervisorScope,
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
		warehouseTriageCount,
		warehouseRepairPool: warehouseSerialCounts.repairPool,
		warehouseNeedsReview: warehouseSerialCounts.needsReview,
		warehouseRefurbished: warehouseSerialCounts.refurbished,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
	}
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const {
		role,
		stats,
		alert,
		docs,
		pendingReviewDocs,
		sentBackDocs,
		supervisorQueues,
		supervisorScope,
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
		warehouseTriageCount,
		warehouseRepairPool,
		warehouseNeedsReview,
		warehouseRefurbished,
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

	return (
		<RoleDashboard
			role={role}
			supervisorQueues={supervisorQueues}
			supervisorScope={supervisorScope}
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
			warehouseTriageCount={warehouseTriageCount}
			warehouseRepairPool={warehouseRepairPool}
			warehouseNeedsReview={warehouseNeedsReview}
			warehouseRefurbished={warehouseRefurbished}
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
