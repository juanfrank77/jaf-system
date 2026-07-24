import fs from "node:fs/promises"
import path from "node:path"
import { Form, redirect } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { generateActaConformidadPdf } from "~/lib/pdf/acta-conformidad.server"
import { generateScheduleAccountsPdf } from "~/lib/pdf/schedule-accounts.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id_.lc"

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "LC_GENERATED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany()
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
	const ivuSetting = await db.systemSetting.findUnique({
		where: { key: "ivu_rate" },
	})
	const ivuRate = parseFloat(ivuSetting?.value ?? "0.115")
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: Number(c.unitPrice),
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
	if (!canTransition(doc.status, "LC_GENERATED", user.role))
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
			unitPrice: Number(code?.unitPrice ?? 0),
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

		const pdfBytes = await generateScheduleAccountsPdf({
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
					status: "LC_GENERATED",
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
						status: { before: "CLARO_UPLOADED", after: "LC_GENERATED" },
					},
				},
			}),
		] as any)

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
	const { doc, serviceCodes, poLinks, ivuRate } = loaderData
	const used = (doc.materialsUsed as any[]) || []
	const claroPdfUrl = doc.claroPdfPath
		? `/files/claro-pdfs/${(doc as any).id}-claro.pdf`
		: null

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">LC Request — Lissette Review</h1>
			<p className="font-mono text-sm text-slate-500">
				{(doc as any).controlNumber}
			</p>
			<p className="text-xs text-slate-400">
				IVU rate: {(ivuRate * 100).toFixed(1)}%
			</p>

			<div className="grid grid-cols-2 gap-4">
				<div className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2">JAF Invoice</h2>
					<div className="text-sm space-y-1">
						<p>
							<span className="text-slate-500">Job:</span>{" "}
							{(doc as any).jobType}
						</p>
						<p>
							<span className="text-slate-500">Address:</span>{" "}
							{(doc as any).jobAddressActual ??
								(doc as any).jobAddressEstimated}
						</p>
						<p>
							<span className="text-slate-500">Aviso #:</span>{" "}
							{(doc as any).avisoNumber ?? "—"}
						</p>
						<p>
							<span className="text-slate-500">Supervisor:</span>{" "}
							{(loaderData as any).supervisor?.name}
						</p>
					</div>
					<div className="mt-3">
						<MaterialLineItems
							serviceCodes={serviceCodes as any}
							initialItems={used}
							readOnly
						/>
					</div>
				</div>
				<div className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2">Claro Work Order PDF</h2>
					{claroPdfUrl ? (
						<iframe
							src={claroPdfUrl}
							className="w-full h-64 border rounded"
							title="Claro PDF"
						/>
					) : (
						<p className="text-sm text-slate-400">No Claro PDF on file.</p>
					)}
				</div>
			</div>

			<div className="flex gap-3">
				<Form method="post">
					<input type="hidden" name="intent" value="generate_acta" />
					<Button type="submit" variant="outline">
						Download Acta de Conformidad (2A)
					</Button>
				</Form>
				<Form method="post">
					<input type="hidden" name="intent" value="generate_schedule" />
					<Button type="submit">
						Generate &amp; Download Schedule of Accounts (2B)
					</Button>
				</Form>
			</div>
			<p className="text-xs text-slate-400">
				Generating the Schedule of Accounts marks this document LC_GENERATED.
				Email the PDF to hs@pbcc.com.
			</p>
		</div>
	)
}
