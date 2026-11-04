import { db } from "~/lib/db.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { ageDays } from "~/lib/finance-stage-rows.server"
import { accountIdsOf, type ShareAccount } from "~/lib/payroll-run.server"

export type ClosedAvisoRow = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	brigade: string
	soldToPbccAt: string | null
	requestSentAt: string | null
	brigadePaidAt: string | null
	/** Whole days from sold to PBCC until the brigade was paid: Monica's clock. */
	daysSoldToPaid: number | null
	/** The payroll request that paid it, titled by pay period. */
	requestLabel: string | null
}

/**
 * Arm A's finished Avisos, newest closed first: sold to PBCC, requested,
 * paid. One row per Aviso, the backup Lissette can print any time.
 */
export async function loadClosedAvisos(opts: {
	page: number
	search?: string
}): Promise<{ rows: ClosedAvisoRow[]; totalCount: number }> {
	const search = opts.search?.trim()
	const where = {
		payablesClosedAt: { not: null },
		...(search && {
			OR: [
				{ controlNumber: { contains: search, mode: "insensitive" as const } },
				{ avisoNumber: { contains: search, mode: "insensitive" as const } },
			],
		}),
	}
	const [totalCount, docs] = await Promise.all([
		db.jafInvoice.count({ where }),
		db.jafInvoice.findMany({
			where,
			orderBy: [{ payablesClosedAt: "desc" }, { id: "asc" }],
			skip: (opts.page - 1) * PAGE_SIZE,
			take: PAGE_SIZE,
			select: {
				id: true,
				controlNumber: true,
				avisoNumber: true,
				pbccRequestSentAt: true,
				contractorAccountId: true,
				contractorShareLines: true,
				contractorAccount: { select: { code: true, label: true } },
				payrollRun: {
					select: {
						label: true,
						sentAt: true,
						accounts: { select: { contractorAccountId: true, paidAt: true } },
					},
				},
			},
		}),
	])
	const rows = docs.map((d): ClosedAvisoRow => {
		// A job with several crews closed when the last one was paid.
		const ids = accountIdsOf(d)
		const paidAt =
			d.payrollRun?.accounts
				.filter((a) => ids.includes(a.contractorAccountId))
				.flatMap((a) => (a.paidAt ? [a.paidAt] : []))
				.sort((a, b) => b.getTime() - a.getTime())[0] ?? null
		const crews = [
			...new Map(
				(Array.isArray(d.contractorShareLines)
					? (d.contractorShareLines as { account?: ShareAccount }[])
					: []
				).flatMap((l) =>
					l?.account ? [[l.account.id, l.account] as const] : [],
				),
			).values(),
		]
		return {
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			brigade:
				crews.length > 0
					? crews.map((a) => `${a.code} ${a.label}`).join(" + ")
					: d.contractorAccount
						? `${d.contractorAccount.code} ${d.contractorAccount.label}`
						: "",
			soldToPbccAt: d.pbccRequestSentAt?.toISOString() ?? null,
			requestSentAt: d.payrollRun?.sentAt?.toISOString() ?? null,
			brigadePaidAt: paidAt?.toISOString() ?? null,
			daysSoldToPaid:
				d.pbccRequestSentAt && paidAt
					? ageDays(d.pbccRequestSentAt, paidAt)
					: null,
			requestLabel: d.payrollRun?.label ?? null,
		}
	})
	return { rows, totalCount }
}
