import { claroStage } from "~/lib/claro-installer.server"
import { db } from "~/lib/db.server"
import {
	chainDates,
	type LogCell,
	type LogColumn,
	type LogRow,
} from "~/lib/log-view"
import {
	buildJournalBlocks,
	puertoRicoDay,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"

/**
 * Carmen's Log: one row per job (brigades) or per order (installers). No JAF
 * price, no Gross, no PBCC amount ever leaves here (rule 1).
 */

export type LogTab = "brigades" | "installers"

const day = (d: Date | null | undefined): string | null =>
	d ? puertoRicoDay(d) : null

export const BRIGADE_COLUMNS: LogColumn[] = [
	{ key: "aviso", label: "Aviso #", labelKey: "log.col.aviso", type: "text" },
	{ key: "jaf", label: "JAF #", labelKey: "log.col.jaf", type: "text" },
	{
		key: "brigade",
		label: "Brigade",
		labelKey: "log.col.brigade",
		type: "text",
	},
	{ key: "acct", label: "Acct #", labelKey: "log.col.acct", type: "text" },
	{
		key: "net",
		label: "Net",
		labelKey: "log.col.net",
		type: "money",
		total: true,
	},
	{
		key: "ret",
		label: "10% Ret",
		labelKey: "log.col.ret",
		type: "money",
		total: true,
	},
	{
		key: "adjNet",
		label: "Adj. Net",
		labelKey: "log.col.adj_net",
		type: "money",
		total: true,
	},
	{
		key: "period",
		label: "Request period",
		labelKey: "log.col.period",
		type: "text",
	},
	{
		key: "sentDate",
		label: "Request sent",
		labelKey: "log.col.request_sent",
		type: "date",
	},
	{
		key: "pbcc",
		label: "Sold to PBCC",
		labelKey: "log.col.pbcc",
		type: "date",
	},
	{ key: "paid", label: "Paid", labelKey: "log.col.paid", type: "date" },
	{ key: "status", label: "Status", labelKey: "log.col.status", type: "text" },
]

export const INSTALLER_COLUMNS: LogColumn[] = [
	{ key: "order", label: "Order #", labelKey: "log.col.order", type: "text" },
	{
		key: "installer",
		label: "Installer",
		labelKey: "log.col.installer",
		type: "text",
	},
	{ key: "emp", label: "Emp #", labelKey: "log.col.emp", type: "text" },
	{
		key: "installed",
		label: "Installed",
		labelKey: "log.col.installed",
		type: "date",
	},
	{
		key: "ewit",
		label: "EWIT invoice #",
		labelKey: "log.col.ewit",
		type: "text",
	},
	{
		key: "invoiced",
		label: "Invoiced",
		labelKey: "log.col.invoiced",
		type: "date",
	},
	{
		key: "batch",
		label: "PBCC batch",
		labelKey: "log.col.batch",
		type: "text",
	},
	{
		key: "sold",
		label: "Sold to PBCC",
		labelKey: "log.col.pbcc",
		type: "date",
	},
	{
		key: "received",
		label: "PBCC paid",
		labelKey: "log.col.pbcc_paid",
		type: "date",
	},
	{
		key: "paid",
		label: "Installer paid",
		labelKey: "log.col.installer_paid",
		type: "date",
	},
	{
		key: "amount",
		label: "Paid $",
		labelKey: "log.col.amount",
		type: "money",
		total: true,
	},
	{
		key: "po",
		label: "PO #",
		labelKey: "log.col.po",
		type: "text",
	},
	{
		key: "withIvu",
		label: "Amount + IVU",
		labelKey: "log.col.with_ivu",
		type: "money",
		total: true,
	},
	{
		key: "aribaSent",
		label: "Ariba sent",
		labelKey: "log.col.ariba_sent",
		type: "date",
	},
	{
		key: "claroPaid",
		label: "Claro paid",
		labelKey: "log.col.claro_paid",
		type: "date",
	},
	{
		key: "claroAmount",
		label: "Claro $",
		labelKey: "log.col.claro_amount",
		type: "money",
		total: true,
	},
	{
		key: "short",
		label: "Short $",
		labelKey: "log.col.short",
		type: "money",
		total: true,
	},
	{
		key: "daysPbccClaro",
		label: "Days PBCC→Claro",
		labelKey: "log.col.days_pbcc_claro",
		type: "number",
	},
	{ key: "status", label: "Status", labelKey: "log.col.status", type: "text" },
]

export const LOG_FILTER_KEYS: Record<LogTab, string[]> = {
	brigades: ["brigade", "status"],
	installers: ["installer", "status"],
}
export const LOG_DEFAULT_DATE: Record<LogTab, string> = {
	brigades: "sentDate",
	installers: "installed",
}
export const logColumns = (tab: LogTab) =>
	tab === "brigades" ? BRIGADE_COLUMNS : INSTALLER_COLUMNS

async function brigadeRows(): Promise<LogRow[]> {
	const runs = await db.payrollRun.findMany({
		where: { sentAt: { not: null } },
		orderBy: { sentAt: "desc" },
		take: 60,
		include: {
			invoices: {
				...RUN_INVOICES,
				select: {
					...RUN_INVOICES.select,
					bankSchedule: { select: { sentAt: true } },
				},
			},
			accounts: true,
		},
	})
	const out: LogRow[] = []
	for (const run of runs) {
		const paidAt = new Map(
			run.accounts.map((a) => [a.contractorAccountId, a.paidAt]),
		)
		const held = new Set(
			run.accounts.filter((a) => a.heldAt).map((a) => a.contractorAccountId),
		)
		const byInvoice = new Map(run.invoices.map((i) => [i.id, i]))
		for (const block of buildJournalBlocks(run.invoices)) {
			const accountId = run.invoices.find(
				(i) => i.contractorAccount?.code === block.accountCode,
			)?.contractorAccount?.id
			const paid = accountId ? (paidAt.get(accountId) ?? null) : null
			for (const job of block.jobs) {
				const pbccSent =
					byInvoice.get(job.invoiceId)?.bankSchedule?.sentAt ?? null
				const [sentDate, pbcc, paidDate] = chainDates([
					day(run.sentAt),
					day(pbccSent),
					day(paid),
				])
				out.push({
					id: `${run.id}:${job.invoiceId}`,
					aviso: job.avisoNumber,
					jaf: job.jobSeq == null ? null : `M-${job.jobSeq}`,
					brigade: block.brigadeLabel,
					acct: block.brigadeCode,
					net: job.net,
					ret: job.retention,
					adjNet: job.adjNet,
					period: run.label,
					sentDate,
					pbcc,
					paid: paidDate,
					status: paid
						? "Paid"
						: accountId && held.has(accountId)
							? "On hold"
							: "Waiting",
				})
			}
		}
	}
	return out
}

const cents = (v: { toString(): string } | number) =>
	Math.round(Number(v) * 100)

const CLARO_STATUS = {
	no_po: "No PO",
	ready_for_ariba: "Ready for Ariba",
	sent: "Sent to Ariba",
	paid: "Claro paid",
	short: "Claro short",
} as const

/** Whole days between two `YYYY-MM-DD` Puerto Rico days; blank until both exist. */
function daysBetween(from: string | null, to: string | null): number | null {
	if (!from || !to) return null
	return Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
}

async function installerRows(): Promise<LogRow[]> {
	const docs = await db.installCompletion.findMany({
		where: { status: "SUBMITTED" },
		orderBy: { createdAt: "desc" },
		take: 2000,
		include: {
			installer: { select: { name: true, installerProfile: true } },
			ewitInvoice: { include: { batch: true } },
			installerPayment: true,
		},
	})
	// An invoice covers many orders: its money shows on one order row only, chosen
	// over the whole set (earliest installed, then order #, then id) so it never
	// depends on the view. A filter that hides that row omits the invoice's money.
	const when = (c: (typeof docs)[number]) =>
		(c.installedAt ?? c.submittedAt ?? c.createdAt).getTime()
	const moneyRow = new Map<string, (typeof docs)[number]>()
	for (const c of docs) {
		if (!c.ewitInvoiceId) continue
		const cur = moneyRow.get(c.ewitInvoiceId)
		if (
			!cur ||
			when(c) < when(cur) ||
			(when(c) === when(cur) &&
				(c.claroOrderNo < cur.claroOrderNo ||
					(c.claroOrderNo === cur.claroOrderNo && c.id < cur.id)))
		)
			moneyRow.set(c.ewitInvoiceId, c)
	}
	return docs.map((c) => {
		const batch = c.ewitInvoice?.batch ?? null
		const payment =
			c.installerPayment && !c.installerPayment.undoneAt
				? c.installerPayment
				: null
		const [invoiced, sold, received, paid] = chainDates([
			day(c.ewitInvoice?.createdAt),
			day(batch?.sentAt),
			day(c.ewitInvoice?.receivedAt),
			day(payment?.paidAt),
		])
		const inv = c.ewitInvoice
		const stage = inv ? claroStage(inv) : null
		const claroPaid = day(inv?.claroPaidAt)
		const showMoney =
			!!c.ewitInvoiceId && moneyRow.get(c.ewitInvoiceId)?.id === c.id
		const withCents = inv?.claroTotal == null ? null : cents(inv.claroTotal)
		const paidCents = inv?.claroPaidNet == null ? null : cents(inv.claroPaidNet)
		const shortCents =
			claroPaid &&
			withCents != null &&
			paidCents != null &&
			paidCents < withCents
				? withCents - paidCents
				: null
		const installed = day(c.installedAt ?? c.submittedAt ?? c.createdAt)
		const status: string = payment
			? "Closed"
			: c.ewitInvoice?.heldAt
				? "On hold"
				: c.ewitInvoice?.receivedAt
					? "Ready to pay"
					: c.ewitInvoice
						? "Waiting for PBCC"
						: "Waiting for EWIT"
		const pbccDone = !!(payment || inv?.receivedAt)
		const claroText =
			stage && pbccDone && !inv?.heldAt
				? `${CLARO_STATUS[stage]}${shortCents != null && inv?.shortAcceptedAt ? " (short accepted)" : ""}`
				: null
		return {
			id: c.id,
			order: c.claroOrderNo,
			installer: c.installer.name,
			emp: c.installer.installerProfile?.jafNumber ?? null,
			installed,
			ewit: c.ewitInvoice?.number ?? null,
			invoiced,
			batch: batch?.number == null ? null : `#${batch.number}`,
			sold,
			received,
			paid,
			amount: payment ? Number(payment.amount) : null,
			po: inv?.poNumber ?? null,
			withIvu: !showMoney || withCents == null ? null : withCents / 100,
			aribaSent: day(inv?.aribaSentAt),
			claroPaid,
			claroAmount: !showMoney || paidCents == null ? null : paidCents / 100,
			short: !showMoney || shortCents == null ? null : shortCents / 100,
			daysPbccClaro: daysBetween(sold, claroPaid),
			status: claroText ? `${status} · ${claroText}` : status,
		} satisfies Record<string, LogCell> & { id: string }
	})
}

export async function loadLogRows(tab: LogTab): Promise<LogRow[]> {
	return tab === "brigades" ? brigadeRows() : installerRows()
}

import {
	applyLogView,
	describeLogView,
	type LogResult,
	type LogView,
	parseLogView,
} from "~/lib/log-view"

export function logTabOf(params: URLSearchParams): LogTab {
	return params.get("tab") === "installers" ? "installers" : "brigades"
}

/** The one place a URL becomes a view of rows: the page, PDF, Excel and Send all call this. */
export async function buildLogReport(request: Request): Promise<{
	tab: LogTab
	view: LogView
	columns: LogColumn[]
	result: LogResult
	filters: string
	title: string
}> {
	const params = new URL(request.url).searchParams
	const tab = logTabOf(params)
	const columns = logColumns(tab)
	const view = parseLogView(params, columns, LOG_FILTER_KEYS[tab], {
		dateBy: LOG_DEFAULT_DATE[tab],
	})
	const result = applyLogView(await loadLogRows(tab), columns, view)
	return {
		tab,
		view,
		columns,
		result,
		filters: describeLogView(view, columns),
		title: tab === "brigades" ? "Brigades log" : "Installers log",
	}
}
