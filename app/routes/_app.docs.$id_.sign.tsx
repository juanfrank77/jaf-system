import fs from "node:fs/promises"
import path from "node:path"
import { useRef, useState } from "react"
import { Form, redirect, useSubmit } from "react-router"
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
import type { Route } from "./+types/_app.docs.$id_.sign"

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
			unitPrice: Number(c.unitPrice),
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
		return { error: "Warehouse release signature is required" }
	}
	if (!crewSignature || crewSignature === "data:,") {
		return { error: "Crew receipt signature is required" }
	}
	if (!warehouseId) {
		return { error: "Please select the warehouse" }
	}

	let materialsTaken: { serviceCodeId: string; qty: number }[] = []
	try {
		materialsTaken = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { error: "Invalid materials data" }
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

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		if (!warehouseId) {
			alert("Please select the warehouse.")
			return
		}
		if (releaseRef.current?.isEmpty()) {
			alert("Warehouse release signature is required.")
			return
		}
		if (crewRef.current?.isEmpty()) {
			alert("Crew receipt signature is required.")
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
			<h1 className="text-xl font-semibold">
				Warehouse Pickup — Dual Signature
			</h1>
			<p className="text-sm font-mono text-slate-500">
				{(doc as any).controlNumber}
			</p>

			<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
				Review materials below. Both warehouse and crew must sign. Once signed,
				this list is permanently locked.
			</div>

			<Form method="post" onSubmit={handleSubmit} className="space-y-5">
				<div>
					<Label>Warehouse</Label>
					<Select
						value={warehouseId}
						onValueChange={(v) => setWarehouseId(v ?? "")}
					>
						<SelectTrigger className="mt-1">
							<SelectValue placeholder="Select warehouse..." />
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
					<Label>Materials Taken</Label>
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
							1. Warehouse Release Signature
						</p>
						<p className="text-xs text-slate-500 mb-2">
							Person releasing materials signs here
						</p>
						<SignaturePad ref={releaseRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => releaseRef.current?.clear()}
							className="text-xs text-slate-400 mt-1 hover:text-slate-600"
						>
							Clear
						</button>
					</div>
					<div>
						<p className="text-sm font-medium mb-1">
							2. Crew Receipt Signature
						</p>
						<p className="text-xs text-slate-500 mb-2">
							Crew member receiving materials signs here
						</p>
						<SignaturePad ref={crewRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => crewRef.current?.clear()}
							className="text-xs text-slate-400 mt-1 hover:text-slate-600"
						>
							Clear
						</button>
					</div>
				</div>

				{(actionData as any)?.error && (
					<p className="text-sm text-red-600">{(actionData as any).error}</p>
				)}

				<Button type="submit" className="w-full">
					Sign & Lock Materials
				</Button>
			</Form>
		</div>
	)
}
