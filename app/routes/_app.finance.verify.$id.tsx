import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { BrigadeStockTracked } from "~/components/brigade-stock-tracked"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Textarea } from "~/components/ui/textarea"
import type { AvisoDiscrepancy } from "~/lib/aviso-discrepancy"
import { brigadeStockFor } from "~/lib/brigade-stock.server"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	billableMaterials,
	computeFinanceStage,
	FINANCEABLE_STATUSES,
	fetchInvoiceTotalContext,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { packetDocuments } from "~/lib/packet-documents"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { storedPdfLinks } from "~/lib/upload-href"
import { cn, formatMoney, toNumberPrice } from "~/lib/utils"
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

	const { serviceCodes, codeMap, ivuRate } = await fetchInvoiceTotalContext()
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)

	return {
		doc,
		user,
		serviceCodes,
		stage,
		amount,
		ivuRate,
		// The supervisor's Aviso-vs-work-order flag, shown read-only.
		avisoDiscrepancy: (doc.avisoDiscrepancy as AvisoDiscrepancy | null) ?? null,
		sendBackNotes: (doc.financeSendBackNotes as SendBackNote[]) || [],
		// The released packet's four documents, each opening its file.
		packetDocs: packetDocuments(doc, doc.preCertSheets[0] ?? null, doc.photos),
		lineTotal:
			doc.jafInvoiceLineTotal != null
				? toNumberPrice(doc.jafInvoiceLineTotal)
				: null,
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
					diffJson: { note },
				},
			}),
		])
		throw redirect("/finance/queue")
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
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "FINANCE_SEND_BACK",
					diffJson: { note },
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
		throw redirect(`/finance/receivables`)
	}

	throw redirect(`/finance/verify/${params.id}`)
}

export default function FinanceVerify({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		serviceCodes,
		stage,
		amount,
		ivuRate,
		sendBackNotes,
		packetDocs,
		avisoDiscrepancy,
		lineTotal,
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
				<span
					className={cn(
						"text-xs bg-muted px-3 py-1 rounded-full font-medium",
						stage === "TO_VERIFY" && "bg-status-info-soft text-status-info",
					)}
				>
					{stage?.replace(/_/g, " ")}
				</span>
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.packets_title")}>
				{t("finance_flow.callout.packets_body")}
			</Callout>

			<div className="text-sm">
				<p>
					{t("finance_verify.amount")}:{" "}
					<span className="font-medium">{formatMoney(amount)}</span>
				</p>
				{lineTotal != null && (
					<p>
						{t("finance_verify.line_sum_pre_ivu")}:{" "}
						<span className="font-medium">{formatMoney(lineTotal)}</span>
					</p>
				)}
				<p>
					{t("finance_verify.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
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
								<p className="text-xs text-muted-foreground">
									{d.href
										? t(`finance_verify.packet.${d.key}_detail` as ParseKeys, {
												file: d.detail,
												count: Number(d.detail) || 0,
											})
										: t("finance_verify.packet.missing")}
								</p>
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
						<Textarea
							name="note"
							rows={2}
							placeholder={t("finance_verify.verify_note_placeholder")}
						/>
						<Button type="submit" disabled={cannotVerify}>
							{t("finance_verify.mark_verified")}
						</Button>
						{cannotVerify && (
							<p className="text-sm text-status-warn">
								{t("finance_verify.cannot_verify_hint")}
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
						{error?.errorKey && (
							<p className="text-sm text-status-danger">
								{t(error.errorKey as ParseKeys)}
							</p>
						)}
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
