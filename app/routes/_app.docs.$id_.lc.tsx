import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { avisoPdfUrl } from "~/lib/aviso-document"
import { db } from "~/lib/db.server"
import { generateActaConformidadPdf } from "~/lib/pdf/acta-conformidad.server"
import { generateScheduleAccountsPdf } from "~/lib/pdf/schedule-accounts.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate, getLcPbccAdvanceRate } from "~/lib/system-settings.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.lc"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — LC Request — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "LC_REQUEST_GENERATED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany()
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
	const ivuRate = await getIvuRate()
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		supervisor,
		poLinks,
		ivuRate,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "LC_REQUEST_GENERATED", user.role))
		throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	const intent = form.get("intent") as string
	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
	const ivuSetting = await db.systemSetting.findUnique({
		where: { key: "ivu_rate" },
	})
	const ivuRate = parseFloat(ivuSetting?.value ?? "0.115")

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const lcDir = path.join(uploadDir, "lc-requests")
	await fs.mkdir(lcDir, { recursive: true })

	const used =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[]) || []
	const lineItems = used.map((item) => {
		const code = codeMap[item.serviceCodeId]
		return {
			claroCode: code?.claroCode ?? "",
			name: code?.name ?? "",
			qty: item.qty,
			unit: code?.unit ?? "SR",
			unitPrice: toNumberPrice(code?.unitPrice ?? 0),
			accountCode: code?.accountCode,
		}
	})

	const today = new Date().toLocaleDateString("en-US")
	const invoiceNumber = `M${new Date().getFullYear()}-${doc.avisoNumber ?? doc.controlNumber}`

	if (intent === "generate_acta") {
		const pdfBytes = await generateActaConformidadPdf({
			controlNumber: doc.controlNumber,
			avisoNumber: doc.avisoNumber,
			jobType: doc.jobType,
			jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
			invoiceNumber,
			invoiceDate: today,
			lineItems,
			supervisorName: supervisor?.name ?? "",
			ivuRate,
		})
		const localPath = path.join(lcDir, `${params.id}-acta.pdf`)
		await fs.writeFile(localPath, pdfBytes)
		return new Response(new Uint8Array(pdfBytes), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${doc.controlNumber}-acta.pdf"`,
			},
		})
	}

	if (intent === "generate_schedule") {
		const subtotal = lineItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)
		const amount = subtotal + subtotal * ivuRate

		const lcPbccAdvanceRate = await getLcPbccAdvanceRate()
		const pdfBytes = await generateScheduleAccountsPdf({
			advancePercent: lcPbccAdvanceRate * 100,
			invoices: [
				{
					invoiceDate: today,
					invoiceNumber,
					debtor: "PRT/CLARO",
					poNumber: poLinks[0]?.claroPONumber ?? "",
					amount,
				},
			],
		})

		const localPath = path.join(lcDir, `${params.id}-schedule.pdf`)
		await fs.writeFile(localPath, pdfBytes)

		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "LC_REQUEST_GENERATED",
					lcRequestPdfPath: localPath,
					lcGeneratedAt: new Date(),
					lcApprovedById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: "CLARO_UPLOADED", after: "LC_REQUEST_GENERATED" },
					},
				},
			}),
		])

		return new Response(new Uint8Array(pdfBytes), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${doc.controlNumber}-schedule.pdf"`,
			},
		})
	}

	throw redirect(`/docs/${params.id}`)
}

export default function LcView({ loaderData }: Route.ComponentProps) {
	const { doc, serviceCodes, ivuRate } = loaderData
	const { t } = useTranslation()
	const used =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[]) || []
	const claroPdfUrl = avisoPdfUrl(doc)

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_lc.title")}</h1>
			<p className="font-mono text-sm text-muted-foreground">
				{doc.controlNumber}
			</p>
			<p className="text-xs text-muted-foreground">
				{t("docs_lc.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
			</p>

			<div className="grid grid-cols-2 gap-4">
				<div className="bg-card border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2">
						{t("docs_lc.jaf_invoice")}
					</h2>
					<div className="text-sm space-y-1">
						<p>
							<span className="text-muted-foreground">{t("docs_lc.job")}:</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("docs_lc.address")}:
							</span>{" "}
							{doc.jobAddressActual ?? doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("docs_lc.aviso_number")}:
							</span>{" "}
							{doc.avisoNumber ?? "—"}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("docs_lc.supervisor")}:
							</span>{" "}
							{loaderData.supervisor?.name}
						</p>
					</div>
					<div className="mt-3">
						<MaterialLineItems
							serviceCodes={serviceCodes}
							initialItems={used}
							readOnly
						/>
					</div>
				</div>
				<div className="bg-card border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2">
						{t("docs_lc.claro_pdf_title")}
					</h2>
					{claroPdfUrl ? (
						<iframe
							src={claroPdfUrl}
							className="w-full h-64 border rounded"
							title={t("docs_lc.claro_pdf_iframe_title")}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("docs_lc.no_claro_pdf")}
						</p>
					)}
				</div>
			</div>

			<div className="flex gap-3">
				<Form method="post">
					<input type="hidden" name="intent" value="generate_acta" />
					<Button type="submit" variant="outline">
						{t("docs_lc.download_acta")}
					</Button>
				</Form>
				<Form method="post">
					<input type="hidden" name="intent" value="generate_schedule" />
					<Button type="submit">{t("docs_lc.generate_schedule")}</Button>
				</Form>
			</div>
			<p className="text-xs text-muted-foreground">
				{t("docs_lc.footer_note")}
			</p>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
