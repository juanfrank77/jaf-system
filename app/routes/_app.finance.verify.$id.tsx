import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceVerifyView } from "~/components/finance-verify-view"
import type { AvisoDiscrepancy } from "~/lib/aviso-discrepancy"
import { brigadeStockFor } from "~/lib/brigade-stock.server"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import { inboxNeighbors } from "~/lib/finance-inbox.server"
import {
	billableMaterials,
	computeFinanceStage,
	FINANCEABLE_STATUSES,
	fetchInvoiceTotalContext,
} from "~/lib/finance-pipeline.server"
import { VERIFY_CHECKS as CHECKS } from "~/lib/finance-verify-checks"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { packetDocuments } from "~/lib/packet-documents"
import { addToOpenBatch } from "~/lib/pbcc-batch.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { InvoiceLine } from "~/lib/service-lines"
import { storedPdfLinks } from "~/lib/upload-href"
import type { Route } from "./+types/_app.finance.verify.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Finance Verify — JAF Ops`
			: "JAF Ops",
	},
]

type SendBackNote = {
	note: string
	byUserId: string
	createdAt: string
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true } },
			preCertSheets: {
				where: { supersededAt: null },
				orderBy: { version: "desc" },
				take: 1,
				select: {
					pdfPath: true,
					sigSupervisorAt: true,
					sigSubcontractorAt: true,
				},
			},
			photos: { select: { localPath: true, tag: true, takenAt: true } },
		},
	})
	if (!FINANCEABLE_STATUSES.includes(doc.status)) {
		throw redirect(`/docs/${params.id}`)
	}

	const { serviceCodes, ivuRate } = await fetchInvoiceTotalContext()
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	// The invoice record: its service lines, each with its own IVU, rounded once.
	const invoiceLines = Array.isArray(doc.jafInvoiceLines)
		? (doc.jafInvoiceLines as InvoiceLine[])
		: []
	const totals = computeInvoiceTotals(invoiceLines, ivuRate)

	return {
		doc,
		user,
		serviceCodes,
		stage,
		invoiceLines: invoiceLines.map((l, i) => ({
			...l,
			ivuRate: totals.lines[i].ivuRate,
			lineAmount: totals.lines[i].lineAmount,
		})),
		totals: {
			subtotal: totals.subtotal,
			ivu4: totals.ivu4,
			ivu115: totals.ivu115,
			total: totals.total,
		},
		neighbors: await inboxNeighbors(doc.id),
		// The supervisor's Aviso-vs-work-order flag, shown read-only.
		avisoDiscrepancy: (doc.avisoDiscrepancy as AvisoDiscrepancy | null) ?? null,
		sendBackNotes: (doc.financeSendBackNotes as SendBackNote[]) || [],
		// The released packet's four documents, each opening its file.
		packetDocs: packetDocuments(doc, doc.preCertSheets[0] ?? null, doc.photos),
		// The stored file is the price-free Claro packet; the priced JAF invoice
		// is rendered on demand (Finance/Admin only) once the packet was sent.
		...storedPdfLinks(doc.jafInvoicePdfPath),
		pricedInvoiceHref: doc.jafInvoiceGeneratedAt
			? `/finance/verify/${doc.id}/invoice.pdf`
			: null,
		// Tracked, not billed (provisional ruling): never added to any total.
		brigadeStock: await brigadeStockFor(doc.fieldMaterials),
		// The material lines Finance bills, listed exactly as billed.
		materials: billableMaterials(doc),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true } },
			preCertSheets: {
				where: { supersededAt: null },
				orderBy: { version: "desc" },
				take: 1,
				select: {
					pdfPath: true,
					sigSupervisorAt: true,
					sigSubcontractorAt: true,
				},
			},
			photos: { select: { localPath: true, tag: true, takenAt: true } },
		},
	})
	if (isTerminalStatus(doc.status)) {
		return { errorKey: "finance_verify.errors.terminal_status" }
	}
	const form = await request.formData()
	const intent = form.get("intent") as string
	if (intent !== "verify" && intent !== "send_back")
		return { errorKey: "finance_verify.errors.unknown_intent" }
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	if (stage !== "TO_VERIFY")
		return { errorKey: "finance_verify.errors.invalid_stage" }

	if (intent === "verify") {
		// All four checks, and all four documents, before a packet is accepted.
		if (!CHECKS.every((c) => form.get(`check_${c}`) === "on"))
			return { errorKey: "finance_verify.errors.checks_required" }
		const present = packetDocuments(
			doc,
			doc.preCertSheets[0] ?? null,
			doc.photos,
		)
		if (present.some((d) => !d.href))
			return { errorKey: "finance_verify.errors.documents_missing" }
		const { nextId } = await inboxNeighbors(params.id)
		// No Aviso-amount check (F2): verifying never asks for or compares one.
		const note = (form.get("note") as string | null)?.trim() || null
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					financeVerifiedAt: new Date(),
					financeVerifiedById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "FINANCE_VERIFIED",
					diffJson: { note, source: "STAMPED" },
				},
			}),
		])
		// The packet becomes the next row of the open PBCC batch, its invoice PDF
		// made on the spot. The accept stands even if this fails: the next batch
		// takes in any accepted packet that is not in one yet.
		try {
			await addToOpenBatch({ docId: params.id, userId: user.id })
		} catch (error) {
			// biome-ignore lint/suspicious/noConsole: the accept already committed; batching is retried
			console.error(`PBCC batch: could not add ${params.id}`, error)
		}
		// Accept & next: straight on to the next packet, no trip back to the list.
		throw redirect(nextId ? `/finance/verify/${nextId}` : "/finance/queue")
	}

	if (intent === "send_back") {
		const note = (form.get("note") as string | null)?.trim() || ""
		if (!note) return { errorKey: "finance_verify.errors.note_required" }
		const history = ((doc.financeSendBackNotes as SendBackNote[]) || []).concat(
			[
				{
					note,
					byUserId: user.id,
					createdAt: new Date().toISOString(),
				},
			],
		)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					financeVerifiedAt: null,
					financeVerifiedById: null,
					financeSendBackNotes: history,
					// Back on the supervisor's desk: no longer released, so it leaves
					// the Inbox and the supervisor can fix it and release it again.
					releasedToFinanceAt: null,
					releasedToFinanceById: null,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "FINANCE_SEND_BACK",
					diffJson: { note, source: "STAMPED" },
				},
			}),
			db.notification.create({
				data: {
					userId: doc.supervisorId,
					docId: params.id,
					message: `Finance returned job ${doc.controlNumber} for Aviso correction: ${note}`,
				},
			}),
		])
		await sendInternalEmail({
			docId: params.id,
			actorId: user.id,
			recipients: doc.supervisor?.email ? [doc.supervisor.email] : [],
			subject: `Finance returned job ${doc.controlNumber}`,
			context: "FINANCE_SEND_BACK",
		})
		throw redirect("/finance/queue")
	}

	throw redirect(`/finance/verify/${params.id}`)
}

export default function FinanceVerify({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return <FinanceVerifyView loaderData={loaderData} actionData={actionData} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
