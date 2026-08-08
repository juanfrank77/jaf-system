import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button, buttonVariants } from "~/components/ui/button"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import type { FinanceStage } from "~/lib/finance-pipeline"
import {
	computeFinanceStage,
	invoiceTotalUsed,
	isMissingAviso,
	isMissingClaroPdf,
} from "~/lib/finance-pipeline.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { cn, formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.verify.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Finance Verify — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { supervisor: true, poLinks: true },
	})
	const financeableStatuses = [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_GENERATED",
	]
	if (!financeableStatuses.includes(doc.status)) {
		throw redirect(`/docs/${params.id}`)
	}

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [
			c.id,
			{ ...c, unitPrice: toNumberPrice(c.unitPrice) },
		]),
	)
	const ivuRate = await getIvuRate()
	const stage = computeFinanceStage(doc, doc.poLinks.length > 0)
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)

	return {
		doc,
		user,
		serviceCodes,
		stage,
		amount,
		ivuRate,
		missingAviso: isMissingAviso(doc),
		missingClaroPdf: isMissingClaroPdf(doc),
		sendBackNotes: (doc.financeSendBackNotes as any[]) || [],
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { supervisor: true },
	})
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "verify") {
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
		throw redirect(`/finance/receivables`)
	}

	if (intent === "send_back") {
		const note = (form.get("note") as string | null)?.trim() || ""
		if (!note) return { errorKey: "finance_verify.errors.note_required" }
		const history = ((doc.financeSendBackNotes as any[]) || []).concat([
			{
				note,
				byUserId: user.id,
				createdAt: new Date().toISOString(),
			},
		])
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
		missingAviso,
		missingClaroPdf,
		sendBackNotes,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | null
	const used = (doc.materialsUsed as any[]) || []
	const taken = (doc.materialsTaken as any[]) || []
	const source = used.length > 0 ? used : taken
	const claroPdfUrl = doc.claroPdfPath
		? `/files/claro-pdfs/${doc.id}-claro.pdf`
		: null
	const jafInvoiceUrl = doc.jafInvoicePdfPath
		? `/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`
		: null

	const cannotVerify = missingAviso || missingClaroPdf

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold">{t("finance_verify.title")}</h1>
					<p className="font-mono text-sm text-slate-500">
						{doc.controlNumber} — {doc.jobType}
					</p>
				</div>
				<span
					className={cn(
						"text-xs bg-slate-100 px-3 py-1 rounded-full font-medium",
						stage === "TO_VERIFY" && "bg-blue-100 text-blue-800",
					)}
				>
					{stage?.replace(/_/g, " ")}
				</span>
			</div>

			<div className="text-sm">
				<p>
					{t("finance_verify.amount")}:{" "}
					<span className="font-medium">{formatMoney(amount)}</span>
				</p>
				<p>
					{t("finance_verify.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
			</div>

			{(missingAviso || missingClaroPdf) && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
					<p className="font-medium text-amber-900">
						{t("finance_verify.billing_blocked")}
					</p>
					<ul className="text-sm text-amber-800 list-disc list-inside">
						{missingAviso && <li>{t("finance_verify.blocked_aviso")}</li>}
						{missingClaroPdf && (
							<li>{t("finance_verify.blocked_claro_pdf")}</li>
						)}
					</ul>
				</div>
			)}

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium">
						{t("finance_verify.jaf_invoice")}
						{jafInvoiceUrl && (
							<a
								href={jafInvoiceUrl}
								target="_blank"
								rel="noreferrer"
								className="ml-2 text-primary underline"
							>
								{t("finance_verify.download")}
							</a>
						)}
					</h2>
					<div className="text-sm space-y-1">
						<p>
							<span className="text-slate-500">
								{t("finance_verify.job_type")}:
							</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-slate-500">
								{t("finance_verify.address")}:
							</span>{" "}
							{doc.jobAddressActual || doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-slate-500">
								{t("finance_verify.aviso_number")}:
							</span>{" "}
							{doc.avisoNumber || "—"}
						</p>
						<p>
							<span className="text-slate-500">
								{t("finance_verify.supervisor")}:
							</span>{" "}
							{loaderData.doc.supervisor?.name}
						</p>
					</div>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={source}
						readOnly
					/>
				</div>

				<div className="bg-white border rounded-lg p-4 space-y-3">
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
						<p className="text-sm text-slate-400">
							{t("finance_verify.no_claro_pdf")}
						</p>
					)}
				</div>
			</div>

			{sendBackNotes.length > 0 && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
					<h3 className="text-sm font-medium text-amber-900">
						{t("finance_verify.previous_send_backs")}
					</h3>
					{sendBackNotes.map((note: any) => (
						<p
							key={`${note.createdAt}-${note.note}`}
							className="text-sm text-amber-800"
						>
							{new Date(note.createdAt).toLocaleString()} — {note.note}
						</p>
					))}
				</div>
			)}

			<div className="flex flex-wrap items-start gap-4">
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="verify" />
					<div>
						<Textarea
							name="note"
							rows={2}
							placeholder={t("finance_verify.verify_note_placeholder")}
						/>
					</div>
					<Button type="submit" disabled={cannotVerify}>
						{t("finance_verify.mark_verified")}
					</Button>
					{cannotVerify && (
						<p className="text-sm text-amber-700">
							{t("finance_verify.cannot_verify_hint")}
						</p>
					)}
				</Form>

				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="send_back" />
					<div>
						<Textarea
							name="note"
							rows={2}
							required
							placeholder={t("finance_verify.send_back_placeholder")}
						/>
					</div>
					<Button type="submit" variant="outline">
						{t("finance_verify.send_back")}
					</Button>
					{error?.errorKey && (
						<p className="text-sm text-red-600">{t(error.errorKey as any)}</p>
					)}
				</Form>
			</div>

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
