import type { NavCount } from "~/components/nav-model"
import { countComptrollerRuns } from "~/lib/comptroller-runs.server"
import { CREW_QUEUES, crewQueueHref, crewQueueWhere } from "~/lib/crew-queues"
import { db } from "~/lib/db.server"
import { carmenOpenSummary, countArmAStages } from "~/lib/finance-stages.server"
import { needsReviewCount, repairPoolCount } from "~/lib/serial-stock"
import {
	SUPERVISOR_SIDEBAR_QUEUES,
	type SupervisorQueue,
	supervisorQueueHref,
	supervisorQueueWhere,
} from "~/lib/supervisor-queues"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import { WAREHOUSE_QUEUES, warehouseQueueHref } from "~/lib/warehouse-queues"
import { countWarehouseQueues } from "~/lib/warehouse-queues.server"
import type { Role } from "../../generated/prisma/client"

/** Ready for pickup and Aviso are the supervisor's own action points, so they go red. */
const CRITICAL_QUEUES: SupervisorQueue[] = ["open", "aviso"]
const SUPERVISOR_QUEUE_ORDER = SUPERVISOR_SIDEBAR_QUEUES

/** "My open jobs" lists every unreleased job, but its badge counts only the
 * jobs Ready for pickup (PREPPED): the ones waiting on the crew. */
function supervisorCountWhere(queue: SupervisorQueue) {
	return queue === "open"
		? { status: "PREPPED" as const, releasedToFinanceAt: null }
		: supervisorQueueWhere(queue)
}

/**
 * Per-role sidebar counts, keyed by nav `to`. Each department sub-project adds
 * its own role here; roles without an entry get no pills.
 */
export async function loadNavCounts(
	user: {
		id: string
		role: Role
	},
	/** The header-switch warehouse; scopes the serial-unit counts. */
	warehouseId?: string | null,
): Promise<Record<string, NavCount>> {
	if (user.role === "SUPERVISOR") {
		const areas = await supervisorAreas(db, user.id)
		const scope = ownedOrInArea(user.id, areas)
		const values = await Promise.all(
			SUPERVISOR_QUEUE_ORDER.map((q) =>
				db.jafInvoice.count({
					where: { AND: [scope, supervisorCountWhere(q)] },
				}),
			),
		)
		return Object.fromEntries(
			SUPERVISOR_QUEUE_ORDER.map((q, i) => [
				supervisorQueueHref(q),
				{
					value: values[i],
					tone: CRITICAL_QUEUES.includes(q) ? "critical" : "neutral",
				},
			]),
		)
	}
	if (user.role === "CREW") {
		const values = await Promise.all(
			CREW_QUEUES.map((q) =>
				db.jafInvoice.count({ where: crewQueueWhere(q, user.id) }),
			),
		)
		return Object.fromEntries(
			CREW_QUEUES.map((q, i) => [
				crewQueueHref(q),
				{ value: values[i], tone: "neutral" },
			]),
		)
	}
	if (user.role === "WAREHOUSE") {
		const [steps, requests, repairs, review] = await Promise.all([
			countWarehouseQueues(),
			db.restockRequest.count({
				where: { status: { in: ["SUBMITTED", "APPROVED"] } },
			}),
			warehouseId ? repairPoolCount(warehouseId) : 0,
			warehouseId ? needsReviewCount(warehouseId) : 0,
		])
		return {
			...Object.fromEntries(
				WAREHOUSE_QUEUES.map((q) => [
					warehouseQueueHref(q),
					{ value: steps[q], tone: "neutral" },
				]),
			),
			"/warehouse/repairs": { value: repairs, tone: "neutral" },
			"/warehouse/needs-review": { value: review, tone: "neutral" },
			"/warehouse/requests": { value: requests, tone: "neutral" },
		}
	}
	if (user.role === "COMPTROLLER" || user.role === "ADMIN") {
		const runs = await countComptrollerRuns()
		return {
			"/comptroller/lists": {
				value: runs.toPay + runs.paid,
				tone: "neutral",
			},
			"/comptroller/to-pay": { value: runs.toPay, tone: "critical" },
			"/comptroller/paid": { value: runs.paid, tone: "neutral" },
		}
	}
	if (user.role === "FINANCE") {
		const [stages, carmen] = await Promise.all([
			countArmAStages(),
			carmenOpenSummary(),
		])
		return {
			"/finance/queue": { value: stages.PACKETS, tone: "neutral" },
			"/finance/lc-requests": { value: stages.LC_REQUEST, tone: "neutral" },
			"/finance/lc-funded": { value: stages.LC_FUNDED, tone: "neutral" },
			"/finance/payroll": { value: stages.LISTS, tone: "neutral" },
			"/finance/awaiting-carmen": {
				value: carmen.openAccounts,
				tone: carmen.overdueRuns > 0 ? "critical" : "neutral",
			},
		}
	}
	return {}
}
