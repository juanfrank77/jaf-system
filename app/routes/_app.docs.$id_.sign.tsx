import fs from "node:fs/promises"
import path from "node:path"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { db } from "~/lib/db.server"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.sign"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Capture Signature — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["CREW", "WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	const warehouses = await db.warehouse.findMany({ where: { active: true } })
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		warehouses,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["CREW", "WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	const releaseSignature = form.get("releaseSignature") as string
	const crewSignature = form.get("crewSignature") as string
	const warehouseId = form.get("warehouseId") as string
	const materialsRaw = form.get("materials") as string

	if (!releaseSignature || releaseSignature === "data:,") {
		return { errorKey: "docs_sign.errors.release_signature_required" }
	}
	if (!crewSignature || crewSignature === "data:,") {
		return { errorKey: "docs_sign.errors.crew_signature_required" }
	}
	if (!warehouseId) {
		return { errorKey: "docs_sign.errors.warehouse_required" }
	}

	let materialsTaken: { serviceCodeId: string; qty: number }[] = []
	try {
		materialsTaken = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_sign.errors.invalid_materials" }
	}

	const serviceCodes = await db.serviceCode.findMany()
	const warehouse = await db.warehouse.findUnique({
		where: { id: warehouseId },
	})
	const pdfBytes = await generateWarehouseReceiptPdf(
		doc as any,
		serviceCodes as any,
		warehouse?.name ?? "",
	)
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const receiptDir = path.join(uploadDir, "receipts")
	await fs.mkdir(receiptDir, { recursive: true })
	const receiptPath = path.join(receiptDir, `${params.id}-receipt.pdf`)
	await fs.writeFile(receiptPath, pdfBytes)

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "SIGNED",
				warehouseId,
				materialsTaken,
				releaseSignature,
				releasedById: user.id,
				releaseSignedAt: new Date(),
				crewSignature,
				signedById: user.id,
				signedAt: new Date(),
				warehouseReceiptPath: receiptPath,
			},
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: {
					status: { before: "PREPPED", after: "SIGNED" },
					warehouseId,
					materialsTaken,
				},
			},
		}),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

export default function SignDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, warehouses } = loaderData
	const releaseRef = useRef<SignaturePadHandle>(null)
	const crewRef = useRef<SignaturePadHandle>(null)
	const [warehouseId, setWarehouseId] = useState("")
	const [items, setItems] = useState((doc.estimatedMaterials as any[]) || [])
	const submit = useSubmit()
	const { t } = useTranslation()

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		if (!warehouseId) {
			alert(t("docs_sign.alerts.select_warehouse"))
			return
		}
		if (releaseRef.current?.isEmpty()) {
			alert(t("docs_sign.alerts.release_signature_required"))
			return
		}
		if (crewRef.current?.isEmpty()) {
			alert(t("docs_sign.alerts.crew_signature_required"))
			return
		}
		const formData = new FormData(e.currentTarget)
		formData.set("releaseSignature", releaseRef.current!.toDataURL())
		formData.set("crewSignature", crewRef.current!.toDataURL())
		formData.set("materials", JSON.stringify(items))
		formData.set("warehouseId", warehouseId)
		submit(formData, { method: "post" })
	}

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_sign.title")}</h1>
			<p className="text-sm font-mono text-slate-500">
				{(doc as any).controlNumber}
			</p>

			<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
				{t("docs_sign.review_notice")}
			</div>

			<Form method="post" onSubmit={handleSubmit} className="space-y-5">
				<div>
					<Label>{t("docs_sign.warehouse_label")}</Label>
					<Select
						value={warehouseId}
						onValueChange={(v) => setWarehouseId(v ?? "")}
					>
						<SelectTrigger className="mt-1">
							<SelectValue placeholder={t("docs_sign.warehouse_placeholder")} />
						</SelectTrigger>
						<SelectContent>
							{warehouses.map((w) => (
								<SelectItem key={w.id} value={w.id}>
									{w.name} — {w.zone}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div>
					<Label>{t("docs_sign.materials_taken_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems
							serviceCodes={serviceCodes as any}
							initialItems={items}
							readOnly={false}
							name="materials"
						/>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<div>
						<p className="text-sm font-medium mb-1">
							{t("docs_sign.release_signature_heading")}
						</p>
						<p className="text-xs text-slate-500 mb-2">
							{t("docs_sign.release_signature_subtext")}
						</p>
						<SignaturePad ref={releaseRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => releaseRef.current?.clear()}
							className="text-xs text-slate-400 mt-1 hover:text-slate-600"
						>
							{t("docs_sign.clear")}
						</button>
					</div>
					<div>
						<p className="text-sm font-medium mb-1">
							{t("docs_sign.crew_signature_heading")}
						</p>
						<p className="text-xs text-slate-500 mb-2">
							{t("docs_sign.crew_signature_subtext")}
						</p>
						<SignaturePad ref={crewRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => crewRef.current?.clear()}
							className="text-xs text-slate-400 mt-1 hover:text-slate-600"
						>
							{t("docs_sign.clear")}
						</button>
					</div>
				</div>

				{(actionData as any)?.errorKey && (
					<p className="text-sm text-red-600">
						{t((actionData as any).errorKey)}
					</p>
				)}

				<Button type="submit" className="w-full">
					{t("docs_sign.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
