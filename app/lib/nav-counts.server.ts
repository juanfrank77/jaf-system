import type { NavCount } from "~/components/nav-model"
import {
	readyRestockCount,
	warehouseBrigadeStockCount,
} from "~/lib/brigade-inventory.server"
import { countComptrollerRuns } from "~/lib/comptroller-runs.server"
import { db } from "~/lib/db.server"
import { carmenOpenSummary, countArmAStages } from "~/lib/finance-stages.server"
import { returnedDocIds } from "~/lib/returned-packet.server"
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

/** Ready for pickup, Returned and Aviso are the supervisor's own action
 * points, so they go red. */
const CRITICAL_QUEUES: SupervisorQueue[] = ["open", "returned", "aviso"]
const SUPERVISOR_QUEUE_ORDER = SUPERVISOR_SIDEBAR_QUEUES

/** "My open jobs" lists the jobs before the packet, but its badge counts only the
 * jobs Ready for pickup (PREPPED): the ones waiting on the crew. */
function supervisorCountWhere(queue: SupervisorQueue, returnedIds: string[]) {
	return queue === "open"
		? { status: "PREPPED" as const, releasedToFinanceAt: null }
		: supervisorQueueWhere(queue, returnedIds)
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
		const returnedIds = await returnedDocIds(scope)
		const values = await Promise.all(
			SUPERVISOR_QUEUE_ORDER.map((q) =>
				db.jafInvoice.count({
					where: { AND: [scope, supervisorCountWhere(q, returnedIds)] },
				}),
			),
		)
		const readyRestocks = await readyRestockCount(user.id)
		return {
			...Object.fromEntries(
				SUPERVISOR_QUEUE_ORDER.map((q, i) => [
					supervisorQueueHref(q),
					{
						value: values[i],
						tone: CRITICAL_QUEUES.includes(q) ? "critical" : "neutral",
					},
				]),
			),
			// A restock waiting at the warehouse.
			"/supervisor/stock": { value: readyRestocks, tone: "critical" },
		}
	}
	if (user.role === "WAREHOUSE") {
		const [steps, requests, repairs, review, brigadeStock] = await Promise.all([
			countWarehouseQueues(),
			db.restockRequest.count({
				where: { status: { in: ["SUBMITTED", "APPROVED"] } },
			}),
			warehouseId ? repairPoolCount(warehouseId) : 0,
			warehouseId ? needsReviewCount(warehouseId) : 0,
			warehouseBrigadeStockCount(),
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
			"/warehouse/brigade-stock": { value: brigadeStock, tone: "neutral" },
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
			"/finance/queue?stage=returned": {
				value: stages.RETURNED,
				tone: stages.RETURNED > 0 ? "critical" : "neutral",
			},
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
