import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import {
	computeFinanceStage,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { generatePbccRequestPdf } from "~/lib/pdf/pbcc-request.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.pbcc.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — PBCC Request — JAF Ops`
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
	if (stage !== "PBCC_REQUEST_PENDING") {
		throw redirect(`/finance/receivables`)
	}
	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [
			c.id,
			{ ...c, unitPrice: toNumberPrice(c.unitPrice) },
		]),
	)
	const ivuRate = await getIvuRate()
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	return { doc, user, serviceCodes, amount, ivuRate }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { supervisor: true, poLinks: true },
	})
	const stage = computeFinanceStage(doc, doc.poLinks.length > 0)
	if (stage !== "PBCC_REQUEST_PENDING") {
		throw redirect(`/finance/receivables`)
	}

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const ivuRate = await getIvuRate()
	const used = (doc.materialsUsed as any[]) || []
	const source = used.length > 0 ? used : (doc.materialsTaken as any[]) || []
	const lineItems = source.map((item) => {
		const code = codeMap[item.serviceCodeId]
		return {
			claroCode: code?.claroCode ?? "",
			name: code?.name ?? "",
			qty: Number(item.qty) || 0,
			unit: code?.unit ?? "SR",
			unitPrice: toNumberPrice(code?.unitPrice),
			accountCode: code?.accountCode,
		}
	})

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const pbccDir = path.join(uploadDir, "pbcc-requests")
	await fs.mkdir(pbccDir, { recursive: true })

	const today = new Date().toLocaleDateString("en-US")
	const invoiceNumber = doc.avisoNumber
		? `M${new Date().getFullYear()}-${doc.avisoNumber}`
		: `M${new Date().getFullYear()}-${doc.controlNumber}`

	const pdfBytes = await generatePbccRequestPdf({
		controlNumber: doc.controlNumber,
		avisoNumber: doc.avisoNumber,
		jobType: doc.jobType,
		jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
		invoiceNumber,
		invoiceDate: today,
		debtor: "PRT/CLARO",
		lineItems,
		ivuRate,
		supervisorName: doc.supervisor?.name ?? "",
		requestDate: today,
	})

	const localPath = path.join(pbccDir, `${params.id}-pbcc-request.pdf`)
	await fs.writeFile(localPath, pdfBytes)

	const comptrollers = await db.user.findMany({
		where: { role: "COMPTOLLER", active: true },
	})

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				pbccRequestPdfPath: localPath,
				pbccRequestSentAt: new Date(),
				karmenCopySentAt: new Date(),
			},
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "PBCC_REQUEST_GENERATED",
				diffJson: { path: localPath },
			},
		}),
		...comptrollers.map((c) =>
			db.notification.create({
				data: {
					userId: c.id,
					docId: params.id,
					message: `PBCC payment request generated for job ${doc.controlNumber}.`,
				},
			}),
		),
	])

	return new Response(new Uint8Array(pdfBytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-pbcc-request.pdf"`,
		},
	})
}

export default function PbccRequest({ loaderData }: Route.ComponentProps) {
	const { doc, amount, ivuRate } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("finance_pbcc.title")}</h1>
			<p className="font-mono text-sm text-slate-500">{doc.controlNumber}</p>

			<div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-slate-500">{t("finance_pbcc.job_type")}:</span>{" "}
					{doc.jobType}
				</p>
				<p>
					<span className="text-slate-500">{t("finance_pbcc.address")}:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				<p>
					<span className="text-slate-500">
						{t("finance_pbcc.aviso_number")}:
					</span>{" "}
					{doc.avisoNumber || "—"}
				</p>
				<p>
					<span className="text-slate-500">{t("finance_pbcc.amount")}:</span>{" "}
					{formatMoney(amount)}
				</p>
				<p>
					<span className="text-slate-500">{t("finance_pbcc.advance")}:</span>{" "}
					{formatMoney(amount * 0.8)}
				</p>
				<p className="text-xs text-slate-400">
					{t("finance_pbcc.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
			</div>

			<p className="text-sm text-muted-foreground">{t("finance_pbcc.hint")}</p>

			<Form method="post">
				<Button type="submit">{t("finance_pbcc.generate_and_download")}</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
