import { db } from "~/lib/db.server"
import { invoiceNumberFor } from "~/lib/invoice-number"
import { ivuRateAtFirstSend } from "~/lib/packet-send.server"
import { generateJafInvoicePdf } from "~/lib/pdf/jaf-invoice.server"
import { requireRole } from "~/lib/permissions.server"
import type { InvoiceLine } from "~/lib/service-lines"
import type { Route } from "./+types/_app.finance.verify.$id.invoice"

const PR_DATE = (d: Date) =>
	d.toLocaleDateString("en-US", { timeZone: "America/Puerto_Rico" })

/**
 * The priced JAF invoice, Finance/Admin only (provisional ruling). Rendered
 * on demand from the lines locked at the first packet send, dated at that
 * send and taxed at the IVU rate recorded with it (today's rate only for a
 * job sent before the rate was recorded), so every download is the same
 * invoice. A job whose packet was never
 * sent has no locked lines yet, so there is no invoice.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUnique({
		where: { id: params.id },
		select: {
			controlNumber: true,
			avisoNumber: true,
			jobType: true,
			jobAddressActual: true,
			jobAddressEstimated: true,
			startedAt: true,
			fieldSubmittedAt: true,
			jafInvoiceGeneratedAt: true,
			jafInvoiceLines: true,
			brigade: { select: { name: true } },
			completedBy: { select: { name: true } },
			supervisor: { select: { name: true } },
			claroSupervisor: { select: { name: true } },
		},
	})
	if (!doc?.jafInvoiceGeneratedAt)
		throw new Response("Not found", { status: 404 })

	const lines = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	const workDate = doc.startedAt ?? doc.fieldSubmittedAt
	const pdf = await generateJafInvoicePdf({
		controlNumber: doc.controlNumber,
		avisoNumber: doc.avisoNumber,
		jobType: doc.jobType,
		jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
		brigadeName: doc.brigade?.name ?? null,
		workDate: workDate ? PR_DATE(workDate) : undefined,
		invoiceDate: PR_DATE(doc.jafInvoiceGeneratedAt),
		invoiceNumber: invoiceNumberFor(doc),
		debtor: "PRT/CLARO",
		lineItems: lines.map((l) => ({
			claroCode: l.claroCode,
			name: l.name,
			qty: l.qty,
			unit: l.unit ?? "",
			unitPrice: l.unitPrice,
			accountCode: l.accountCode,
		})),
		// The first send's rate, so a re-download never re-prices the IVU.
		ivuRate: await ivuRateAtFirstSend(params.id),
		supervisorName: doc.completedBy?.name ?? doc.supervisor.name,
		claroSupervisorName: doc.claroSupervisor?.name ?? null,
	})
	const safeName = doc.controlNumber.replace(/[^A-Za-z0-9._-]/g, "_")
	return new Response(new Uint8Array(pdf), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${safeName}-jaf-invoice.pdf"`,
		},
	})
}
