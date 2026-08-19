import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import {
	checkAmountTolerance,
	computeFinanceStage,
	fetchInvoiceTotalContext,
	financeLineItems,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { generateFinalClaroDocPdf } from "~/lib/pdf/final-claro-doc.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.po.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — PO & Final Claro Doc — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { supervisor: true, poLinks: true },
	})
	const stage = computeFinanceStage(doc, doc.poLinks.length > 0)
	if (stage !== "WAITING_CLARO_PO" && stage !== "PO_RECEIVED_UPLOAD") {
		throw redirect(`/finance/receivables`)
	}
	const { codeMap, ivuRate } = await fetchInvoiceTotalContext()
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	return { doc, user, amount, ivuRate }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { supervisor: true, poLinks: true },
	})
	const stage = computeFinanceStage(doc, doc.poLinks.length > 0)
	if (stage !== "WAITING_CLARO_PO" && stage !== "PO_RECEIVED_UPLOAD") {
		throw redirect(`/finance/receivables`)
	}

	const form = await request.formData()
	const intent = form.get("intent") as string
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"

	if (intent === "record_po") {
		const poNumber = (form.get("poNumber") as string | null)?.trim() || ""
		const poDateRaw = (form.get("poDate") as string | null)?.trim() || null
		const poPdf = form.get("poPdf") as File
		const poAmountRaw = (form.get("poAmount") as string | null)?.trim() || ""
		if (!poNumber) return { errorKey: "finance_po.errors.po_number_required" }

		let poPdfPath: string | null = null
		let poPdfRelativePath: string | null = null
		if (poPdf && poPdf.size > 0) {
			const validation = validateFile(poPdf, "pdf")
			if (!validation.valid) return { errorMessage: validation.error }
			const poDir = path.join(uploadDir, "po-docs")
			await fs.mkdir(poDir, { recursive: true })
			poPdfRelativePath = `po-docs/${params.id}-po.pdf`
			poPdfPath = path.join(uploadDir, poPdfRelativePath)
			await fs.writeFile(poPdfPath, Buffer.from(await poPdf.arrayBuffer()))
		}

		const poDate = poDateRaw ? new Date(`${poDateRaw}T00:00:00`) : null
		const poAmount = poAmountRaw ? Number(poAmountRaw) : null
		if (
			poAmount !== null &&
			(!/^\d+(\.\d+)?$/.test(poAmountRaw) ||
				Number.isNaN(poAmount) ||
				!Number.isFinite(poAmount) ||
				poAmount < 0)
		) {
			return { errorKey: "finance_po.errors.invalid_po_amount" }
		}

		const { codeMap, ivuRate, tolerance } = await fetchInvoiceTotalContext()
		const invoiceTotal = invoiceTotalUsed(doc, codeMap, ivuRate)
		const mismatch =
			poAmount !== null &&
			!checkAmountTolerance(invoiceTotal, poAmount, tolerance).withinTolerance

		await db.$transaction([
			db.poLink.create({
				data: {
					docId: params.id,
					claroPONumber: poNumber,
					poDate,
					amount: poAmount,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PO_RECORDED",
					diffJson: {
						poNumber,
						poDate: poDateRaw,
						poPdfPath: poPdfRelativePath,
						poAmount,
						invoiceTotal,
						mismatch,
					},
				},
			}),
			...(mismatch
				? [
						db.notification.create({
							data: {
								userId: doc.supervisorId,
								docId: params.id,
								message: `PO amount ${formatMoney(poAmount)} for job ${doc.controlNumber} differs from invoice total ${formatMoney(invoiceTotal)}.`,
							},
						}),
					]
				: []),
		])
	}

	if (intent === "generate_final_doc") {
		if (doc.poLinks.length === 0) {
			return { errorKey: "finance_po.errors.record_po_first" }
		}
		const serviceCodes = await db.serviceCode.findMany()
		const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
		const ivuRate = await getIvuRate()
		const lineItems = financeLineItems(doc, codeMap)

		const today = new Date().toLocaleDateString("en-US")
		const invoiceNumber = doc.avisoNumber
			? `M${new Date().getFullYear()}-${doc.avisoNumber}`
			: `M${new Date().getFullYear()}-${doc.controlNumber}`

		const pdfBytes = await generateFinalClaroDocPdf({
			controlNumber: doc.controlNumber,
			avisoNumber: doc.avisoNumber,
			claroPONumber: doc.poLinks[0]?.claroPONumber,
			jobType: doc.jobType,
			jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
			invoiceNumber,
			invoiceDate: today,
			lineItems,
			ivuRate,
			supervisorName: doc.supervisor?.name ?? "",
			generatedDate: today,
		})

		const finalDir = path.join(uploadDir, "final-claro-docs")
		await fs.mkdir(finalDir, { recursive: true })
		const localPath = path.join(finalDir, `${params.id}-final-claro-doc.pdf`)
		await fs.writeFile(localPath, pdfBytes)

		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					finalClaroDocPath: localPath,
					finalClaroUploadedAt: new Date(),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "FINAL_CLARO_DOC_GENERATED",
					diffJson: { path: localPath },
				},
			}),
		])

		return new Response(new Uint8Array(pdfBytes), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${doc.controlNumber}-final-claro-doc.pdf"`,
			},
		})
	}

	throw redirect(`/finance/po/${params.id}`)
}

export default function FinancePo({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, amount, ivuRate } = loaderData
	const { t } = useTranslation()
	const error = actionData as {
		errorKey?: string
		errorMessage?: string
	} | null
	const poLinks = doc.poLinks
	const finalDocUrl = doc.finalClaroDocPath
		? `/files/final-claro-docs/${doc.id}-final-claro-doc.pdf`
		: null

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("finance_po.title")}</h1>
			<p className="font-mono text-sm text-slate-500">{doc.controlNumber}</p>

			<div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-slate-500">{t("finance_po.job_type")}:</span>{" "}
					{doc.jobType}
				</p>
				<p>
					<span className="text-slate-500">{t("finance_po.address")}:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				<p>
					<span className="text-slate-500">{t("finance_po.amount")}:</span>{" "}
					{formatMoney(amount)}
				</p>
				<p className="text-xs text-slate-400">
					{t("finance_po.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
			</div>

			{poLinks.length > 0 && (
				<div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
					<h2 className="font-medium">{t("finance_po.recorded_pos")}</h2>
					{poLinks.map((po) => (
						<div key={po.id} className="flex justify-between">
							<span>{po.claroPONumber}</span>
							<span>{formatMoney(Number(po.amount ?? 0))}</span>
						</div>
					))}
				</div>
			)}

			{poLinks.length === 0 && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="bg-white border rounded-lg p-4 space-y-3"
				>
					<h2 className="font-medium text-sm">
						{t("finance_po.record_po_heading")}
					</h2>
					<input type="hidden" name="intent" value="record_po" />
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<div className="space-y-1">
							<Label htmlFor="poNumber">
								{t("finance_po.po_number_label")}
							</Label>
							<Input
								id="poNumber"
								name="poNumber"
								placeholder="PO-12345"
								required
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="poDate">{t("finance_po.po_date_label")}</Label>
							<Input id="poDate" name="poDate" type="date" />
						</div>
						<div className="space-y-1">
							<Label htmlFor="poAmount">{t("finance_po.amount_label")}</Label>
							<Input
								id="poAmount"
								name="poAmount"
								type="number"
								step="0.01"
								min="0"
								placeholder={t("finance_po.amount_placeholder")}
							/>
							<p className="text-xs text-slate-500">
								{t("finance_po.amount_hint")}
							</p>
						</div>
					</div>
					<div className="space-y-1">
						<Label htmlFor="poPdf">{t("finance_po.po_pdf_label")}</Label>
						<Input
							id="poPdf"
							name="poPdf"
							type="file"
							accept="application/pdf"
						/>
					</div>
					<Button type="submit" variant="outline">
						{t("finance_po.record_po")}
					</Button>
					{error?.errorKey && (
						<p className="text-sm text-red-600">{t(error.errorKey as any)}</p>
					)}
					{error?.errorMessage && (
						<p className="text-sm text-red-600">{error.errorMessage}</p>
					)}
				</Form>
			)}

			{poLinks.length > 0 && !doc.finalClaroDocPath && (
				<div className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">
						{t("finance_po.generate_final_doc_heading")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t("finance_po.generate_final_doc_hint")}
					</p>
					<Form method="post">
						<input type="hidden" name="intent" value="generate_final_doc" />
						<Button type="submit">{t("finance_po.generate_final_doc")}</Button>
					</Form>
					{error?.errorKey && (
						<p className="text-sm text-red-600">{t(error.errorKey as any)}</p>
					)}
				</div>
			)}

			{finalDocUrl && (
				<div className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">
						{t("finance_po.final_doc_heading")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t("finance_po.final_doc_hint")}
					</p>
					<a
						href={finalDocUrl}
						target="_blank"
						rel="noreferrer"
						className="text-primary underline text-sm"
					>
						{t("finance_po.download_final_doc")}
					</a>
					<p className="text-xs text-slate-400">
						{t("finance_po.uploaded_on", {
							date: doc.finalClaroUploadedAt
								? new Date(doc.finalClaroUploadedAt).toLocaleDateString()
								: "—",
						})}
					</p>
				</div>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
