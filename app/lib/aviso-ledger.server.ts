import {
	type AvisoRaw,
	type AvisoSummary,
	summarizeAviso,
} from "~/lib/aviso-summary"
import { invoiceNumber } from "~/lib/claro-invoice"
import { db } from "~/lib/db.server"
import type { Prisma } from "../../generated/prisma/client"

const num = (d: { toString(): string } | null | undefined) =>
	d === null || d === undefined ? null : Number(d.toString())

const INCLUDE = {
	supervisor: { select: { name: true } },
	brigade: { select: { name: true, code: true, area: true } },
	bankSchedule: { select: { number: true } },
	payrollRun: { select: { sentAt: true } },
	claroPos: {
		where: { status: "CONFIRMED" as const },
		orderBy: [{ poDate: "asc" as const }, { id: "asc" as const }],
		include: { invoice: true },
	},
} satisfies Prisma.JafInvoiceInclude

type DocWith = Prisma.JafInvoiceGetPayload<{ include: typeof INCLUDE }>

function toRaw(d: DocWith): AvisoRaw {
	const lines = Array.isArray(d.jafInvoiceLines)
		? (d.jafInvoiceLines as { qty: number; unitPrice: number }[])
		: []
	return {
		id: d.id,
		avisoNumber: d.avisoNumber,
		controlNumber: d.controlNumber,
		address: d.jobAddressActual ?? d.jobAddressEstimated,
		supervisor: d.supervisor.name,
		brigades: d.brigade
			? [
					d.brigade.code
						? `${d.brigade.code} ${d.brigade.name}`
						: d.brigade.name,
				]
			: [],
		zone: d.brigade?.area ?? null,
		jobCompletedAt: d.completedAt ?? d.fieldSubmittedAt,
		lines,
		releasedAt: d.releasedToFinanceAt,
		acceptedAt: d.financeVerifiedAt,
		soldAt: d.pbccRequestSentAt,
		batchNumber: d.bankSchedule?.number ?? null,
		payrollRequestAt: d.payrollRun?.sentAt ?? null,
		brigadePaidAt: d.payablesClosedAt,
		armBClosedAt: d.receivableClosedAt,
		pos: d.claroPos.map((p) => ({
			poId: p.id,
			poNumber: p.poNumber ?? "",
			poDate: p.poDate,
			poSubtotal: num(p.subtotal) ?? 0,
			poTotal: num(p.total) ?? 0,
			poConfirmedAt: p.confirmedAt,
			termsDays: p.termsDays,
			invoice: p.invoice
				? {
						id: p.invoice.id,
						series: p.invoice.series,
						seq: p.invoice.seq,
						total: Number(p.invoice.total),
						madeAt: p.invoice.madeAt,
						loadedAt: p.invoice.loadedAt,
						dueDate: p.invoice.dueDate,
						paidAt: p.invoice.paidAt,
						paidNet: num(p.invoice.paidNet),
						voucherId: p.invoice.voucherId,
						shortAcceptedAt: p.invoice.shortAcceptedAt,
					}
				: null,
		})),
	}
}

export async function loadAviso(id: string, now = new Date()) {
	const d = await db.jafInvoice.findUnique({ where: { id }, include: INCLUDE })
	return d ? summarizeAviso(toRaw(d), now) : null
}

/** Search by Aviso # (or control #): partial match, newest first. */
export async function searchAvisos(q: string, take = 25) {
	const term = q.trim()
	if (!term) return []
	const rows = await db.jafInvoice.findMany({
		where: {
			OR: [
				{ avisoNumber: { contains: term } },
				{ controlNumber: { contains: term, mode: "insensitive" } },
			],
		},
		orderBy: { createdAt: "desc" },
		take,
		select: {
			id: true,
			avisoNumber: true,
			controlNumber: true,
			jobAddressEstimated: true,
		},
	})
	return rows
}

export async function avisoHistory(docId: string) {
	const rows = await db.auditTrail.findMany({
		where: { docId },
		orderBy: [{ timestamp: "asc" }, { id: "asc" }],
		include: { user: { select: { name: true } } },
	})
	return rows.map((r) => ({
		id: r.id,
		action: r.action,
		at: r.timestamp.toISOString(),
		by: r.user.name,
		source:
			((r.diffJson as { source?: string } | null)?.source as
				| string
				| undefined) ?? null,
	}))
}

/** Documents on the record: packet files plus the PO / invoice / advice PDFs. */
export async function avisoDocuments(docId: string) {
	const doc = await db.jafInvoice.findUnique({
		where: { id: docId },
		select: {
			avisoDocPath: true,
			jafInvoicePdfPath: true,
			bankInvoicePdfPath: true,
			claroPos: {
				where: { status: "CONFIRMED" },
				select: {
					id: true,
					poNumber: true,
					invoice: {
						select: { id: true, series: true, seq: true, filePath: true },
					},
				},
			},
		},
	})
	if (!doc) return []
	const adviceIds = await db.adviceLine.findMany({
		where: { invoice: { docId } },
		select: { advice: { select: { id: true, reference: true } } },
	})
	const adviceSeen = new Map(
		adviceIds.map((a) => [a.advice.id, a.advice.reference]),
	)
	return [
		{ kind: "aviso" as const, label: "Aviso", path: doc.avisoDocPath },
		{
			kind: "packet" as const,
			label: "Claro packet",
			path: doc.jafInvoicePdfPath,
		},
		{
			kind: "pbcc_invoice" as const,
			label: "PBCC invoice",
			path: doc.bankInvoicePdfPath,
		},
		...doc.claroPos.map((p) => ({
			kind: "po" as const,
			label: `PO ${p.poNumber}`,
			href: `/finance/awaiting-po/${p.id}/file`,
		})),
		...doc.claroPos.flatMap((p) =>
			p.invoice?.filePath
				? [
						{
							kind: "claro_invoice" as const,
							label: `Invoice ${invoiceNumber(p.invoice)}`,
							href: `/finance/awaiting-ariba/${p.invoice.id}/file`,
						},
					]
				: [],
		),
		...[...adviceSeen].map(([id, ref]) => ({
			kind: "advice" as const,
			label: `Payment Advice ${ref ?? ""}`.trim(),
			href: `/finance/payment-advice/${id}/file`,
		})),
	]
}

/**
 * One row per Aviso with any event in [from, to]: released, accepted, sold,
 * payroll sent, brigade paid, a PO, an invoice made / loaded, or a payment.
 */
export async function ledgerSummaries(
	from: Date,
	to: Date,
	now = new Date(),
): Promise<AvisoSummary[]> {
	const docs = await db.jafInvoice.findMany({
		where: { releasedToFinanceAt: { not: null, lte: to } },
		include: INCLUDE,
		orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
	})
	const within = (d: Date | null | undefined) => !!d && d >= from && d <= to
	return docs
		.filter((d) => {
			const events = [
				d.releasedToFinanceAt,
				d.financeVerifiedAt,
				d.pbccRequestSentAt,
				d.payrollRun?.sentAt,
				d.payablesClosedAt,
				d.receivableClosedAt,
				...d.claroPos.flatMap((p) => [
					p.poDate,
					p.confirmedAt,
					p.invoice?.madeAt,
					p.invoice?.loadedAt,
					p.invoice?.paidAt,
				]),
			]
			return events.some(within)
		})
		.map((d) => summarizeAviso(toRaw(d), now))
}

/** Loaded in Ariba, not closed, and past the PO's terms: the Home "Claro past due" box. */
export async function claroPastDue(now = new Date()) {
	const rows = await db.claroInvoice.findMany({
		where: {
			loadedAt: { not: null },
			OR: [{ paidAt: null }, { shortAcceptedAt: null }],
		},
		select: {
			loadedAt: true,
			total: true,
			paidAt: true,
			paidNet: true,
			shortAcceptedAt: true,
			claroPo: { select: { termsDays: true } },
		},
	})
	let count = 0
	let oldestDays = 0
	for (const r of rows) {
		const fullyPaid = r.paidAt && Number(r.paidNet ?? 0) >= Number(r.total)
		if (fullyPaid || r.shortAcceptedAt) continue
		const days = Math.floor(
			((r.paidAt ?? now).getTime() - (r.loadedAt as Date).getTime()) /
				86_400_000,
		)
		const late = days - (r.claroPo?.termsDays ?? 60)
		if (late > 0) {
			count++
			oldestDays = Math.max(oldestDays, late)
		}
	}
	return { count, oldestDays }
}
