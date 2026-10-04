import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	computeFinanceStage,
	financeLineItems,
	invoiceTotalUsed,
	isMissingAviso,
	isMissingClaroPdf,
} from "~/lib/finance-pipeline.server"
import { generatePbccRequestPdf } from "~/lib/pdf/pbcc-request.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate, getLcPbccAdvanceRate } from "~/lib/system-settings.server"
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
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true } },
		},
	})
	if (isTerminalStatus(doc.status)) {
		throw redirect("/finance/receivables")
	}
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
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
	const [ivuRate, lcPbccAdvanceRate] = await Promise.all([
		getIvuRate(),
		getLcPbccAdvanceRate(),
	])
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	return { doc, user, serviceCodes, amount, ivuRate, lcPbccAdvanceRate }
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
		return { errorKey: "finance_pbcc.errors.terminal_status" }
	}
	const form = await request.formData()
	const intent = form.get("intent")
	if (intent !== "generate_pbcc")
		return { errorKey: "finance_pbcc.errors.unknown_intent" }
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	if (stage !== "PBCC_REQUEST_PENDING") {
		throw redirect(`/finance/receivables`)
	}
	if (isMissingAviso(doc) || isMissingClaroPdf(doc)) {
		throw redirect(`/finance/receivables`)
	}

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const [ivuRate, lcPbccAdvanceRate] = await Promise.all([
		getIvuRate(),
		getLcPbccAdvanceRate(),
	])
	const lineItems = financeLineItems(doc, codeMap)

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
		lcPbccAdvanceRate,
	})

	const localPath = path.join(pbccDir, `${params.id}-pbcc-request.pdf`)
	await fs.writeFile(localPath, pdfBytes)

	const comptrollers = await db.user.findMany({
		where: { role: "COMPTROLLER", active: true },
		select: { id: true, email: true },
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
	await sendInternalEmail({
		docId: params.id,
		actorId: user.id,
		recipients: comptrollers.map((recipient) => recipient.email),
		subject: `PBCC payment request generated: ${doc.controlNumber}`,
		context: "PBCC_REQUEST_GENERATED",
	})

	return new Response(new Uint8Array(pdfBytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-pbcc-request.pdf"`,
		},
	})
}

export default function PbccRequest({ loaderData }: Route.ComponentProps) {
	const { doc, amount, ivuRate, lcPbccAdvanceRate } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("finance_pbcc.title")}</h1>
			<p className="font-mono text-sm text-muted-foreground">
				{doc.controlNumber}
			</p>

			<div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.job_type")}:
					</span>{" "}
					{doc.jobType}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.address")}:
					</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.aviso_number")}:
					</span>{" "}
					{doc.avisoNumber || "—"}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.amount")}:
					</span>{" "}
					{formatMoney(amount)}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.advance", {
							rate: (lcPbccAdvanceRate * 100).toFixed(1),
						})}
						:
					</span>{" "}
					{formatMoney(amount * lcPbccAdvanceRate)}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("finance_pbcc.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
			</div>

			<p className="text-sm text-muted-foreground">{t("finance_pbcc.hint")}</p>

			<Form method="post">
				<input type="hidden" name="intent" value="generate_pbcc" />
				<Button type="submit">{t("finance_pbcc.generate_and_download")}</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
