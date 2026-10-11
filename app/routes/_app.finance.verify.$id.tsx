import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	checkAmountTolerance,
	computeFinanceStage,
	FINANCEABLE_STATUSES,
	fetchInvoiceTotalContext,
	invoiceTotalUsed,
	isMissingClaroPdf,
} from "~/lib/finance-pipeline.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
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
		},
	})
	if (!FINANCEABLE_STATUSES.includes(doc.status)) {
		throw redirect(`/docs/${params.id}`)
	}

	const { serviceCodes, codeMap, ivuRate, tolerance } =
		await fetchInvoiceTotalContext()
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
		tolerance,
		missingClaroPdf: isMissingClaroPdf(doc),
		sendBackNotes: (doc.financeSendBackNotes as SendBackNote[]) || [],
		prefilledAvisoAmount:
			doc.avisoMatchedAt && doc.avisoLineTotal != null
				? toNumberPrice(doc.avisoLineTotal)
				: null,
		lineTotal:
			doc.jafInvoiceLineTotal != null
				? toNumberPrice(doc.jafInvoiceLineTotal)
				: null,
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
		if (isMissingClaroPdf(doc)) {
			return { errorKey: "finance_verify.billing_blocked" }
		}
		if (
			doc.avisoMatchedAt &&
			doc.avisoLineTotal != null &&
			doc.jafInvoiceLineTotal != null
		) {
			const avisoAmount = toNumberPrice(doc.avisoLineTotal)
			const invoiceTotal = toNumberPrice(doc.jafInvoiceLineTotal)
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
						diffJson: {
							note,
							avisoAmount,
							invoiceTotal,
							difference: Math.abs(avisoAmount - invoiceTotal),
							withinTolerance: true,
							source: "SUPERVISOR_CAPTURE",
						},
					},
				}),
			])
			throw redirect("/finance/queue")
		}
		const avisoAmountRaw = (form.get("avisoAmount") as string | null)?.trim()
		const avisoAmount = avisoAmountRaw ? Number(avisoAmountRaw) : NaN
		if (
			!avisoAmountRaw ||
			Number.isNaN(avisoAmount) ||
			!Number.isFinite(avisoAmount) ||
			avisoAmount < 0
		) {
			return { errorKey: "finance_verify.errors.invalid_aviso_amount" }
		}
		const { codeMap, ivuRate, tolerance } = await fetchInvoiceTotalContext()
		const invoiceTotal = invoiceTotalUsed(doc, codeMap, ivuRate)
		const { withinTolerance, difference } = checkAmountTolerance(
			invoiceTotal,
			avisoAmount,
			tolerance,
		)
		if (!withinTolerance) {
			return {
				errorKey: "finance_verify.errors.amount_mismatch",
				avisoAmount: avisoAmountRaw,
				invoiceTotal,
				difference,
				tolerance,
			}
		}
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
					diffJson: {
						note,
						avisoAmount,
						invoiceTotal,
						difference,
						withinTolerance: true,
					},
				},
			}),
		])
		throw redirect(`/finance/receivables`)
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
		tolerance,
		missingClaroPdf,
		sendBackNotes,
		prefilledAvisoAmount,
		lineTotal,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as
		| {
				errorKey?: string
				avisoAmount?: string
				invoiceTotal?: number
				difference?: number
				tolerance?: number
		  }
		| undefined
	const used =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[]) || []
	const taken =
		(doc.materialsTaken as { serviceCodeId: string; qty: number }[]) || []
	const source = used.length > 0 ? used : taken
	const claroPdfUrl = doc.claroPdfPath
		? `/files/claro-pdfs/${doc.id}-claro.pdf`
		: null
	const jafInvoiceUrl = doc.jafInvoicePdfPath
		? `/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`
		: null

	const cannotVerify =
		missingClaroPdf ||
		stage !== "TO_VERIFY" ||
		doc.status === "LC_REQUEST_GENERATED"

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
				<p className="text-xs text-muted-foreground">
					{t("finance_verify.tolerance", { tolerance: formatMoney(tolerance) })}
				</p>
			</div>

			{missingClaroPdf && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-4">
					<p className="font-medium text-status-warn">
						{t("finance_verify.billing_blocked")}
					</p>
					<ul className="text-sm text-status-warn list-disc list-inside">
						<li>{t("finance_verify.blocked_claro_pdf")}</li>
					</ul>
				</div>
			)}

			{error?.errorKey === "finance_verify.errors.amount_mismatch" && (
				<div className="bg-status-danger-soft border border-status-danger-line rounded-lg p-4">
					<p className="font-medium text-status-danger">
						{t("finance_verify.amount_mismatch", {
							difference: formatMoney(error.difference ?? 0),
							tolerance: formatMoney(error.tolerance ?? 0),
						})}
					</p>
					<p className="text-sm text-status-danger mt-1">
						{t("finance_verify.amount_mismatch_detail", {
							avisoAmount: formatMoney(Number(error.avisoAmount ?? 0)),
							invoiceTotal: formatMoney(error.invoiceTotal ?? 0),
						})}
					</p>
				</div>
			)}

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium">
						{t("finance_verify.jaf_invoice")}
						{jafInvoiceUrl && (
							<a
								href={jafInvoiceUrl}
								target="_blank"
								rel="noreferrer"
								className="ml-2 text-accent-text underline"
							>
								{t("finance_verify.download")}
							</a>
						)}
					</h2>
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
						initialItems={source}
						readOnly
					/>
				</div>

				<div className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium">
						{t("finance_verify.claro_work_order")}
					</h2>
					{claroPdfUrl ? (
						<iframe
							src={claroPdfUrl}
							className="w-full h-96 border rounded"
							title={t("finance_verify.claro_pdf_title")}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("finance_verify.no_claro_pdf")}
						</p>
					)}
				</div>
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
						{prefilledAvisoAmount != null ? (
							<div>
								<Label htmlFor="avisoAmountPrefilled">
									{t("finance_verify.aviso_amount_label")}
								</Label>
								<p
									id="avisoAmountPrefilled"
									className="mt-1 text-sm font-medium text-status-ok bg-status-ok-soft border border-status-ok/30 rounded px-2 py-1"
								>
									{t("finance_verify.aviso_amount_prefilled", {
										amount: formatMoney(prefilledAvisoAmount),
									})}
								</p>
							</div>
						) : (
							<div>
								<Label htmlFor="avisoAmount">
									{t("finance_verify.aviso_amount_label")}
								</Label>
								<Input
									id="avisoAmount"
									name="avisoAmount"
									type="number"
									step="0.01"
									min="0"
									defaultValue={actionData?.avisoAmount ?? ""}
									placeholder={t("finance_verify.aviso_amount_placeholder")}
									className="mt-1"
									required
								/>
								<p className="text-xs text-muted-foreground mt-1">
									{t("finance_verify.aviso_amount_hint")}
								</p>
							</div>
						)}
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
						{error?.errorKey &&
							error.errorKey !== "finance_verify.errors.amount_mismatch" && (
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
			<a
				href={`/finance/receivables`}
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				{t("finance_verify.back")}
			</a>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
