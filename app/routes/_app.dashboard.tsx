import { redirect } from "react-router"
import { RoleDashboard } from "~/components/dashboards/role-dashboard"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { refuseCrew } from "~/lib/crew-notice.server"
import {
	computeDashboardStats,
	computeMaterialSignals,
	type DashboardExplainer,
} from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { isDashboardFiltersEnabled } from "~/lib/features.server"
import { isMissingAvisoPdf } from "~/lib/finance-pipeline.server"
import { type OpenJobLabel, openJobLabel } from "~/lib/open-job-label"
import { pageTitle } from "~/lib/page-title"
import { requireSession } from "~/lib/permissions.server"
import { isPriceBlind } from "~/lib/service-codes.server"
import {
	parseSupervisorQueue,
	supervisorQueueWhere,
} from "~/lib/supervisor-queues"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	type SupervisorStage,
	WAITING_ON,
	type WaitingOn,
} from "~/lib/supervisor-stage"
import { getAvisoAmountTolerance } from "~/lib/system-settings.server"
import { toNumberPrice } from "~/lib/utils"
import { NO_WAREHOUSE_COUNTS } from "~/lib/warehouse-queues"
import { countWarehouseQueues } from "~/lib/warehouse-queues.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { DocStatus, Prisma, Role } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.dashboard"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.dashboard") },
]

/**
 * The columns the dashboard lists and tiles read (`DashboardDocList`, the
 * stage chips, `computeDashboardStats`). A price-blind role gets only these,
 * so no invoice line, total, payable or signature reaches its payload.
 */
const PRICE_FREE_DOC_SELECT = {
	id: true,
	controlNumber: true,
	status: true,
	jobType: true,
	jobAddressEstimated: true,
	createdAt: true,
	avisoNumber: true,
	assignedCrewIds: true,
	sendBackHistory: true,
	estimatedMaterials: true,
	materialsTaken: true,
	materialsUsed: true,
	materialsReturned: true,
	fieldMaterials: true,
	prepChangedSincePrep: true,
	preppedAt: true,
	fieldStartedAt: true,
	supervisorApprovedAt: true,
	jafInvoiceGeneratedAt: true,
	claroUploadedAt: true,
	avisoMatchedAt: true,
	releasedToFinanceAt: true,
	financeVerifiedAt: true,
	pbccRequestSentAt: true,
	lcGeneratedAt: true,
	advanceReceivedAt: true,
	finalPaymentReceivedAt: true,
	receivableClosedAt: true,
} satisfies Prisma.JafInvoiceSelect

type DashboardListDoc = Prisma.JafInvoiceGetPayload<{
	select: typeof PRICE_FREE_DOC_SELECT
}>

/** The whole row for Finance / Admin; only the list columns for everyone else. */
function findDashboardDocs(
	role: Role,
	args: {
		where: Prisma.JafInvoiceWhereInput
		orderBy: Prisma.JafInvoiceOrderByWithRelationInput
		take: number
	},
): Promise<DashboardListDoc[]> {
	return isPriceBlind(role)
		? db.jafInvoice.findMany({ ...args, select: PRICE_FREE_DOC_SELECT })
		: db.jafInvoice.findMany(args)
}

/** "My open jobs" lists every unreleased job; the other lists stay short. */
const OPEN_JOBS_LIMIT = 200
const LIST_LIMIT = 50

async function buildBaseWhere(
	role: Role,
	userId: string,
): Promise<Record<string, unknown>> {
	if (role === "SUPERVISOR") {
		const areas = await supervisorAreas(db, userId)
		return ownedOrInArea(userId, areas)
	}
	// Finance only sees work orders the supervisor released to Finance;
	// supervisor-stage docs never reach them. Composes by key with the status /
	// crew / job-type filters and the search `OR`, so the gate survives all of them.
	if (role === "FINANCE") return { releasedToFinanceAt: { not: null } }
	return {} // WAREHOUSE, ADMIN see all
}

type QueueRow = {
	id: string
	controlNumber: string
	jobAddressEstimated: string
	jobAddressActual: string | null
	brigadeName: string | null
	stage: SupervisorStage
	note?: string | null
	/** When the job entered this queue (submitted / returned / approved). */
	since: Date | null
	qtyDiscrepancy: boolean
	/** Why a job sits in the Blocked queue. */
	blockReason?: "aviso_mismatch" | "billing_aviso_pdf"
	/** Open work orders list: who the job is waiting on. */
	waitingOn?: WaitingOn
}

const queueSelect = {
	id: true,
	controlNumber: true,
	status: true,
	jobType: true,
	jobAddressEstimated: true,
	jobAddressActual: true,
	createdAt: true,
	fieldStartedAt: true,
	supervisorApprovedAt: true,
	jafInvoiceGeneratedAt: true,
	jafInvoiceLineTotal: true,
	avisoLineTotal: true,
	avisoMatchedAt: true,
	releasedToFinanceAt: true,
	fieldSubmittedAt: true,
	avisoDocPath: true,
	claroPdfPath: true,
	estimatedMaterials: true,
	materialsTaken: true,
	materialsUsed: true,
	materialsReturned: true,
	fieldMaterials: true,
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
		fieldStartedAt: Date | null
		supervisorApprovedAt: Date | null
		jafInvoiceGeneratedAt: Date | null
		avisoMatchedAt: Date | null
		releasedToFinanceAt: Date | null
	},
>(
	docs: T[],
): Promise<(T & { stage: SupervisorStage; openLabel: OpenJobLabel })[]> {
	const sheets = await db.preCertSheet.findMany({
		where: { docId: { in: docs.map((d) => d.id) }, supersededAt: null },
		select: { docId: true, sigSupervisorAt: true, sigSubcontractorAt: true },
	})
	const byDoc = new Map(sheets.map((s) => [s.docId, s]))
	return docs.map((d) => ({
		...d,
		stage: deriveSupervisorStage(d, byDoc.get(d.id) ?? null),
		openLabel: openJobLabel(d, byDoc.get(d.id) ?? null),
	}))
}

async function loadSupervisorQueues(userId: string) {
	const tolerance = await getAvisoAmountTolerance()
	const areas = await supervisorAreas(db, userId)
	const scope = ownedOrInArea(userId, areas)
	const [intakeRaw, pending, approved, billingBlockedRaw, openRaw] =
		await Promise.all([
			db.jafInvoice.findMany({
				where: { ...scope, status: "CREATED" },
				select: queueSelect,
				orderBy: { createdAt: "desc" },
				take: 50,
			}),
			db.jafInvoice.findMany({
				where: { ...scope, status: "FIELD_UPDATED" },
				select: queueSelect,
				orderBy: { fieldSubmittedAt: "desc" },
				take: 50,
			}),
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
			// Released to Finance without an Aviso PDF on file: billing cannot start.
			db.jafInvoice.findMany({
				where: {
					...scope,
					releasedToFinanceAt: { not: null },
					status: { not: "CANCELLED" },
					avisoDocPath: null,
					claroPdfPath: null,
					payablesClosedAt: null,
				},
				select: queueSelect,
				orderBy: { releasedToFinanceAt: "asc" },
				take: 50,
			}),
			// Everything the supervisor owns, from creation until it is paid.
			db.jafInvoice.findMany({
				where: {
					...scope,
					status: { not: "CANCELLED" },
					payablesClosedAt: null,
				},
				select: queueSelect,
				orderBy: { createdAt: "desc" },
				take: 100,
			}),
		])
	const intake = intakeRaw.map((d) => toRow(d, "INTAKE", d.createdAt))
	const myOpen = (await withStages(openRaw)).map((d) => ({
		...toRow(d, d.stage, d.createdAt),
		openLabel: d.openLabel,
		waitingOn: WAITING_ON[d.stage],
	}))
	const pendingReview = pending.map((d) =>
		toRow(d, "APPROVE", d.fieldSubmittedAt),
	)
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
			blocked.push({
				...toRow(d, "AVISO", d.supervisorApprovedAt),
				blockReason: "aviso_mismatch",
			})
		} else {
			approvedRows.push(toRow(d, stage, d.supervisorApprovedAt))
		}
	}
	for (const d of billingBlockedRaw) {
		if (!isMissingAvisoPdf(d)) continue
		blocked.push({
			...toRow(d, "RELEASED", d.releasedToFinanceAt),
			blockReason: "billing_aviso_pdf",
		})
	}
	return {
		intake,
		myOpen,
		pendingReview,
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
	refuseCrew(user.role)

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
		throw redirect("/comptroller")
	}

	const url = new URL(request.url)
	const statusFilter = url.searchParams.get("status")
	const crewFilter = url.searchParams.get("crew")
	const jobTypeFilter = url.searchParams.get("jobType")
	const searchFilter = url.searchParams.get("search")?.trim() || ""

	// A supervisor's sidebar queue (`?stage=`): one step of the work-order rail.
	const stageQueue =
		user.role === "SUPERVISOR"
			? parseSupervisorQueue(url.searchParams.get("stage"))
			: null

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

	if (stageQueue) {
		where.AND = [
			...(Array.isArray(where.AND) ? where.AND : []),
			supervisorQueueWhere(stageQueue),
		]
	}

	const docs = await findDashboardDocs(user.role, {
		where,
		orderBy: { createdAt: "desc" },
		take: stageQueue === "open" ? OPEN_JOBS_LIMIT : LIST_LIMIT,
	})

	// LC_REQUEST_GENERATED is Finance/Admin-only in all projections.
	const visibleDocs =
		user.role === "FINANCE" || user.role === "ADMIN"
			? docs
			: docs.filter((d) => d.status !== "LC_REQUEST_GENERATED")

	// The supervisor's tiles describe their whole scope, so a filter that
	// narrows the list must not also shrink the counts.
	const hasFilters =
		!!stageQueue ||
		!!selectedStatus ||
		!!selectedCrew ||
		!!selectedJobType ||
		!!searchFilter
	const statsDocs =
		user.role === "SUPERVISOR" && hasFilters
			? (
					await findDashboardDocs(user.role, {
						where: baseWhere,
						orderBy: { createdAt: "desc" },
						take: LIST_LIMIT,
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

	// WAREHOUSE counts come from the shared warehouse-queues module so the
	// dashboard cards and the sidebar pills always agree.
	const warehouseCounts =
		user.role === "WAREHOUSE"
			? await countWarehouseQueues()
			: NO_WAREHOUSE_COUNTS
	const warehouseToPrepDocs =
		user.role === "WAREHOUSE"
			? await findDashboardDocs(user.role, {
					where: {
						...(await buildBaseWhere(user.role, user.id)),
						status: "CREATED",
					},
					orderBy: { createdAt: "desc" },
					take: LIST_LIMIT,
				})
			: []

	const warehouseTriageCount = await (async () => {
		if (user.role !== "WAREHOUSE") return 0
		// Follows the header warehouse switch (`wh` cookie) like every other
		// warehouse-scoped query, instead of pinning to the first assignment.
		const { selectedId } = await resolveWarehouseScope(db, request, user)
		if (!selectedId) return 0
		return db.serialLocation.count({
			where: { status: "RETURNED", currentRef: selectedId },
		})
	})()

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
		stageQueue,
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
		warehouseToPrepDocs,
		warehouseCounts,
		warehouseTriageCount,
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
		stageQueue,
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
		warehouseToPrepDocs,
		warehouseCounts,
		warehouseTriageCount,
	} = loaderData
	const explainer = (loaderData as { explainer?: DashboardExplainer })
		.explainer as DashboardExplainer

	return (
		<RoleDashboard
			role={role}
			supervisorQueues={supervisorQueues}
			supervisorScope={supervisorScope}
			stageQueue={stageQueue}
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
			warehouseToPrepDocs={warehouseToPrepDocs}
			warehouseCounts={warehouseCounts}
			warehouseTriageCount={warehouseTriageCount}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
