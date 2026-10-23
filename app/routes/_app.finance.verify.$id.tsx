import type { ParseKeys } from "i18next"
import { type ComponentProps, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { BrigadeStockTracked } from "~/components/brigade-stock-tracked"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Checkbox } from "~/components/ui/checkbox"
import { Textarea } from "~/components/ui/textarea"
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
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { packetDocuments } from "~/lib/packet-documents"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { InvoiceLine } from "~/lib/service-lines"
import { storedPdfLinks } from "~/lib/upload-href"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.verify.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Finance Verify — JAF Ops`
			: "JAF Ops",
	},
]

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

const CHECKS = ["invoice", "aviso", "photos", "precert"] as const

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

// Keyed by packet: "Accept & next" keeps this screen mounted, and the four
// checks must start unticked for every packet.
export default function FinanceVerify(props: Route.ComponentProps) {
	return <VerifyPacket key={props.loaderData.doc.id} {...props} />
}

function VerifyPacket({ loaderData, actionData }: Route.ComponentProps) {
	const {
		doc,
		serviceCodes,
		stage,
		invoiceLines,
		totals,
		neighbors,
		sendBackNotes,
		packetDocs,
		avisoDiscrepancy,
		packetHref,
		legacyPricedHref,
		pricedInvoiceHref,
		brigadeStock,
		materials,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | undefined

	const cannotVerify =
		stage !== "TO_VERIFY" || doc.status === "LC_REQUEST_GENERATED"
	const [checks, setChecks] = useState({
		invoice: false,
		aviso: false,
		photos: false,
		precert: false,
	})
	// Accept stays grey until all four are ticked and no document is missing.
	const readyToAccept =
		CHECKS.every((c) => checks[c]) && packetDocs.every((d) => d.href)

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold">
							{t("finance_verify.title")}
						</h1>
						<StageChip arm="A" step={1} total={5} />
					</div>
					<p className="font-mono text-sm text-muted-foreground">
						{doc.controlNumber} — {doc.jobType}
					</p>
				</div>
				<nav className="flex items-center gap-3 text-sm">
					{neighbors.position > 0 && (
						<span className="text-muted-foreground">
							{t("finance_verify.position", {
								position: neighbors.position,
								total: neighbors.total,
							})}
						</span>
					)}
					{neighbors.prevId ? (
						<Link
							to={`/finance/verify/${neighbors.prevId}`}
							className="underline"
						>
							‹ {t("finance_verify.prev")}
						</Link>
					) : null}
					{neighbors.nextId ? (
						<Link
							to={`/finance/verify/${neighbors.nextId}`}
							className="underline"
						>
							{t("finance_verify.next")} ›
						</Link>
					) : null}
				</nav>
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.packets_title")}>
				{t("finance_flow.callout.packets_body")}
			</Callout>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="text-sm font-medium">
					{t("finance_verify.preview.heading")}
				</h2>
				{invoiceLines.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("finance_verify.preview.empty")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="p-2">{t("finance_verify.preview.code")}</th>
									<th className="p-2">{t("finance_verify.preview.service")}</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.qty")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.price")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.ivu")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.amount")}
									</th>
								</tr>
							</thead>
							<tbody>
								{invoiceLines.map((l) => (
									<tr key={l.serviceCodeId} className="border-b last:border-0">
										<td className="p-2 font-mono">{l.claroCode}</td>
										<td className="p-2">{l.name}</td>
										<td className="p-2 text-right font-mono">{l.qty}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(l.unitPrice)}
										</td>
										<td className="p-2 text-right font-mono">
											{`${+(l.ivuRate * 100).toFixed(2)}%`}
										</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(l.lineAmount)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 text-sm">
					<dt className="text-muted-foreground">
						{t("finance_verify.subtotal")}
					</dt>
					<dd className="text-right font-mono">
						{formatMoney(totals.subtotal)}
					</dd>
					<dt className="text-muted-foreground">{t("finance_verify.ivu_4")}</dt>
					<dd className="text-right font-mono">{formatMoney(totals.ivu4)}</dd>
					<dt className="text-muted-foreground">
						{t("finance_verify.ivu_115")}
					</dt>
					<dd className="text-right font-mono">{formatMoney(totals.ivu115)}</dd>
					<dt className="font-medium">{t("finance_verify.total")}</dt>
					<dd className="text-right font-mono font-medium">
						{formatMoney(totals.total)}
					</dd>
				</dl>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-2">
				<h2 className="text-sm font-medium">
					{t("finance_verify.packet.heading")}
				</h2>
				<ul className="divide-y text-sm">
					{packetDocs.map((d) => (
						<li
							key={d.key}
							className="flex flex-wrap items-center justify-between gap-2 py-2"
						>
							<div>
								<p className="font-medium">
									{t(d.label as ParseKeys, {
										number: doc.avisoNumber ?? "—",
									})}
								</p>
								{d.href ? (
									<p className="text-xs text-muted-foreground">
										{t(`finance_verify.packet.${d.key}_detail` as ParseKeys, {
											file: d.detail,
											count: Number(d.detail) || 0,
										})}
									</p>
								) : (
									<Badge variant="warn">
										{t("finance_verify.packet.missing")}
									</Badge>
								)}
							</div>
							{d.files.length > 0 ? (
								<ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
									{d.files.map((f) => (
										<li key={f.href}>
											<a
												href={f.href}
												target="_blank"
												rel="noreferrer"
												className="text-accent-text underline"
											>
												{f.name}
											</a>
										</li>
									))}
								</ul>
							) : (
								d.href && (
									<a
										href={d.href}
										target="_blank"
										rel="noreferrer"
										className="text-accent-text underline"
									>
										{t("finance_verify.packet.open")}
									</a>
								)
							)}
						</li>
					))}
				</ul>
			</div>

			{avisoDiscrepancy && (
				<Callout title={t("finance_verify.aviso_discrepancy_title")}>
					<ul className="list-disc pl-5">
						{avisoDiscrepancy.differences.map((d) => (
							<li key={d.claroCode}>
								{t("docs_review.aviso_difference", {
									workOrder: d.workOrder,
									aviso: d.aviso,
									name: d.name,
								})}
							</li>
						))}
					</ul>
					{avisoDiscrepancy.note && (
						<p className="mt-1">
							{t("docs_review.aviso_discrepancy_note", {
								note: avisoDiscrepancy.note,
							})}
						</p>
					)}
				</Callout>
			)}

			<div className="grid grid-cols-1 gap-4">
				<div className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium">
						{t("finance_verify.jaf_invoice")}
					</h2>
					{(pricedInvoiceHref || packetHref || legacyPricedHref) && (
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
							{pricedInvoiceHref && (
								<a
									href={pricedInvoiceHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.priced_invoice")}
								</a>
							)}
							{packetHref && (
								<a
									href={packetHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.claro_packet")}
								</a>
							)}
							{legacyPricedHref && (
								<a
									href={legacyPricedHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.priced_invoice_legacy")}
								</a>
							)}
						</div>
					)}
					<div className="text-sm space-y-1">
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.job_type")}:
							</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.address")}:
							</span>{" "}
							{doc.jobAddressActual || doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.aviso_number")}:
							</span>{" "}
							{doc.avisoNumber || "—"}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.supervisor")}:
							</span>{" "}
							{loaderData.doc.supervisor?.name}
						</p>
					</div>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={materials}
						readOnly
					/>
				</div>
				<BrigadeStockTracked lines={brigadeStock} />
			</div>

			{sendBackNotes.length > 0 && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-4 space-y-2">
					<h3 className="text-sm font-medium text-status-warn">
						{t("finance_verify.previous_send_backs")}
					</h3>
					{sendBackNotes.map((note) => (
						<p
							key={`${note.createdAt}-${note.note}`}
							className="text-sm text-status-warn"
						>
							{new Date(note.createdAt).toLocaleString()} — {note.note}
						</p>
					))}
				</div>
			)}

			{stage === "TO_VERIFY" && doc.status !== "LC_REQUEST_GENERATED" && (
				<div className="flex flex-wrap items-start gap-4">
					<Form method="post" className="space-y-3">
						<input type="hidden" name="intent" value="verify" />
						<fieldset className="space-y-2">
							{CHECKS.map((c) => (
								<label
									key={c}
									htmlFor={`check_${c}`}
									className="flex items-center gap-2 text-sm"
								>
									<Checkbox
										id={`check_${c}`}
										name={`check_${c}`}
										checked={checks[c]}
										onCheckedChange={(v) =>
											setChecks((prev) => ({ ...prev, [c]: v === true }))
										}
									/>
									{t(`finance_verify.checks.${c}`)}
								</label>
							))}
						</fieldset>
						<Textarea
							name="note"
							rows={2}
							placeholder={t("finance_verify.verify_note_placeholder")}
						/>
						<Button type="submit" disabled={cannotVerify || !readyToAccept}>
							{t("finance_verify.accept_next")}
						</Button>
						{cannotVerify && (
							<p className="text-sm text-status-warn">
								{t("finance_verify.cannot_verify_hint")}
							</p>
						)}
						{error?.errorKey && (
							<p className="text-sm text-status-danger">
								{t(error.errorKey as ParseKeys)}
							</p>
						)}
					</Form>
					<Form method="post" className="space-y-3">
						<input type="hidden" name="intent" value="send_back" />
						<Textarea
							name="note"
							rows={2}
							required
							placeholder={t("finance_verify.send_back_placeholder")}
						/>
						<Button type="submit" variant="outline">
							{t("finance_verify.send_back")}
						</Button>
					</Form>
				</div>
			)}
			{stage !== "TO_VERIFY" && (
				<p className="text-sm text-muted-foreground">
					{t("finance_verify.errors.invalid_stage")}
				</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
