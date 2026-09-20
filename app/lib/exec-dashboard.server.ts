import type { DocStatus } from "../../generated/prisma/client"
import { db } from "./db.server"
import {
	computeExecDashboard,
	type ExecDashboardData,
	type ExecInvoiceInput,
} from "./exec-dashboard"
import type { FinanceStage } from "./finance-pipeline"
import {
	computeFinanceStage,
	daysInStage,
	FINANCEABLE_STATUSES,
	fetchInvoiceTotalContext,
	invoiceTotalUsed,
} from "./finance-pipeline.server"
import { getAgingAlertDays } from "./system-settings.server"
import { toNumberPrice } from "./utils"

const FIELD_STATUSES: DocStatus[] = ["SIGNED", "FIELD_UPDATED"]
const OPEN_RESTOCK_STATUSES = [
	"REQUESTED",
	"PENDING_APPROVAL",
	"APPROVED",
	"READY",
]

/**
 * Loads the executive (FINANCE / ADMIN) command-center figures. Everything
 * here is read from the live tables: JAF invoices, PO links, payment
 * records, brigades, install logs and restock requests.
 */
export async function loadExecDashboard(
	now: Date = new Date(),
): Promise<ExecDashboardData> {
	const yearStart = new Date(now.getFullYear(), 0, 1)
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

	const [{ codeMap, ivuRate, tolerance }, agingAlertDays] = await Promise.all([
		fetchInvoiceTotalContext(),
		getAgingAlertDays(),
	])

	const [
		financeable,
		fieldJobs,
		avisoJobs,
		installersTotal,
		installLogsToday,
		brigades,
		restockRequests,
	] = await Promise.all([
		db.jafInvoice.findMany({
			where: { status: { in: FINANCEABLE_STATUSES } },
			select: {
				id: true,
				controlNumber: true,
				avisoNumber: true,
				status: true,
				createdAt: true,
				supervisorApprovedAt: true,
				claroPdfPath: true,
				receivableClosedAt: true,
				jafInvoiceLineTotal: true,
				avisoLineTotal: true,
				avisoMatchedAt: true,
				materialsUsed: true,
				materialsTaken: true,
				advanceReceivedAt: true,
				finalPaymentReceivedAt: true,
				finalClaroUploadedAt: true,
				pbccRequestSentAt: true,
				financeVerifiedAt: true,
				poLinks: { select: { amount: true, poDate: true } },
				paymentRecords: {
					select: { type: true, amount: true, date: true },
				},
				brigade: { select: { name: true } },
			},
			orderBy: { supervisorApprovedAt: "asc" },
			take: 2000,
		}),
		db.jafInvoice.findMany({
			where: { status: { in: FIELD_STATUSES } },
			select: { supervisor: { select: { name: true } } },
			take: 2000,
		}),
		db.jafInvoice.findMany({
			where: {
				createdAt: { gte: yearStart },
				status: { not: "CANCELLED" },
				avisoNumber: { not: null },
			},
			select: { createdAt: true },
			take: 5000,
		}),
		db.user.count({ where: { role: "INSTALLER", active: true } }),
		db.installLog.findMany({
			where: { date: { gte: dayStart } },
			select: { installerId: true },
			distinct: ["installerId"],
		}),
		db.brigade.findMany({
			where: { active: true },
			select: { area: true },
		}),
		db.vanRestockRequest.findMany({
			where: { status: { in: OPEN_RESTOCK_STATUSES } },
			select: { status: true, warehouse: { select: { name: true } } },
			take: 500,
		}),
	])

	const invoices: ExecInvoiceInput[] = financeable.map((inv) => {
		const stage = computeFinanceStage(
			inv,
			inv.poLinks.length > 0,
			inv.paymentRecords,
		) as FinanceStage | null
		const poDate = inv.poLinks[0]?.poDate ?? null
		const crewPayment = inv.paymentRecords.find(
			(p) => p.type === "CREW_PAYMENT",
		)
		const amount =
			inv.jafInvoiceLineTotal != null
				? toNumberPrice(inv.jafInvoiceLineTotal)
				: invoiceTotalUsed(inv, codeMap, ivuRate)
		return {
			id: inv.id,
			controlNumber: inv.controlNumber,
			avisoNumber: inv.avisoNumber,
			status: inv.status,
			createdAt: inv.createdAt,
			supervisorApprovedAt: inv.supervisorApprovedAt,
			claroPdfPath: inv.claroPdfPath,
			receivableClosedAt: inv.receivableClosedAt,
			amount,
			avisoLineTotal:
				inv.avisoLineTotal == null ? null : toNumberPrice(inv.avisoLineTotal),
			avisoMatchedAt: inv.avisoMatchedAt,
			poAmounts: inv.poLinks
				.filter((l) => l.amount != null)
				.map((l) => toNumberPrice(l.amount)),
			crewPaidAt: crewPayment?.date ?? null,
			stage,
			stageDays: stage
				? daysInStage(inv, stage, poDate, inv.paymentRecords)
				: 0,
			brigadeName: inv.brigade?.name ?? null,
		}
	})

	return computeExecDashboard(
		{
			invoices,
			fieldJobs: fieldJobs.map((j) => ({
				supervisorName: j.supervisor?.name ?? null,
			})),
			avisoJobs,
			installersTotal,
			installersOnRoadToday: installLogsToday.length,
			brigadeAreas: brigades.map((b) => b.area),
			restockRequests: restockRequests.map((r) => ({
				status: r.status,
				warehouseName: r.warehouse?.name ?? "—",
			})),
			tolerance,
			agingAlertDays,
		},
		now,
	)
}
