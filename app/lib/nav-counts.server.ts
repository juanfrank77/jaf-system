import type { NavCount } from "~/components/nav-model"
import { countComptrollerRuns } from "~/lib/comptroller-runs.server"
import { db } from "~/lib/db.server"
import { carmenOpenSummary, countArmAStages } from "~/lib/finance-stages.server"
import {
	type SupervisorQueue,
	supervisorQueueHref,
	supervisorQueueWhere,
} from "~/lib/supervisor-queues"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import { Prisma, type Role } from "../../generated/prisma/client"

/** Review and Aviso are the supervisor's own action points, so they go red. */
const CRITICAL_QUEUES: SupervisorQueue[] = ["review", "aviso"]
const SUPERVISOR_QUEUE_ORDER: SupervisorQueue[] = [
	"review",
	"invoice",
	"aviso",
	"precert",
	"released",
	"all",
]

/**
 * Per-role sidebar counts, keyed by nav `to`. Each department sub-project adds
 * its own role here; roles without an entry get no pills.
 */
export async function loadNavCounts(user: {
	id: string
	role: Role
}): Promise<Record<string, NavCount>> {
	if (user.role === "SUPERVISOR") {
		const areas = await supervisorAreas(db, user.id)
		const scope = ownedOrInArea(user.id, areas)
		const values = await Promise.all(
			SUPERVISOR_QUEUE_ORDER.map((q) =>
				db.jafInvoice.count({
					where: { AND: [scope, supervisorQueueWhere(q)] },
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
	if (user.role === "WAREHOUSE") {
		const [prep, pickup, returns, requests] = await Promise.all([
			db.jafInvoice.count({ where: { status: "CREATED" } }),
			db.jafInvoice.count({ where: { status: "PREPPED" } }),
			db.jafInvoice.count({
				where: {
					status: { in: ["SIGNED", "FIELD_UPDATED"] },
					materialsReturned: { equals: Prisma.DbNull },
				},
			}),
			db.restockRequest.count({
				where: { status: { in: ["SUBMITTED", "APPROVED"] } },
			}),
		])
		return {
			"/dashboard#to-prep": { value: prep, tone: "neutral" },
			"/dashboard#awaiting-pickup": { value: pickup, tone: "neutral" },
			"/dashboard#returns-due": { value: returns, tone: "neutral" },
			"/warehouse/restock#requests": { value: requests, tone: "neutral" },
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
