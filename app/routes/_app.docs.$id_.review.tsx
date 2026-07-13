import fs from "node:fs/promises"
import path from "node:path"
import { Form, redirect } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id_.review"

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	const serviceCodes = await db.serviceCode.findMany()
	const photos = await db.photo.findMany({ where: { docId: params.id } })
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	return { doc, user, serviceCodes, photos, supervisor }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "approve") {
		if (!canTransition(doc.status, "SUPERVISOR_APPROVED", user.role))
			throw redirect(`/docs/${params.id}`)
		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || doc.avisoNumber
		const claroNotes = (form.get("claroNotes") as string | null)?.trim() || null
		await db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "SUPERVISOR_APPROVED",
				supervisorApprovedAt: new Date(),
				avisoNumber,
				claroNotes,
			},
		})
		await db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: {
					status: { before: doc.status, after: "SUPERVISOR_APPROVED" },
				},
			},
		})
	}

	if (intent === "upload_claro") {
		if (!canTransition(doc.status, "CLARO_UPLOADED", user.role))
			throw redirect(`/docs/${params.id}`)
		const claroPdf = form.get("claroPdf") as File
		if (!claroPdf || claroPdf.size === 0)
			return { error: "Please select the Claro PDF to upload" }
		const validation = validateFile(claroPdf, "pdf")
		if (!validation.valid) return { error: validation.error }
		const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
		const claroDir = path.join(uploadDir, "claro-pdfs")
		await fs.mkdir(claroDir, { recursive: true })
		const localPath = path.join(claroDir, `${params.id}-claro.pdf`)
		await fs.writeFile(localPath, Buffer.from(await claroPdf.arrayBuffer()))
		await db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "CLARO_UPLOADED",
				claroPdfPath: localPath,
				claroUploadedAt: new Date(),
			},
		})
		await db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: {
					status: { before: "SUPERVISOR_APPROVED", after: "CLARO_UPLOADED" },
				},
			},
		})
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.notification.createMany({
			data: finance.map((f) => ({
				userId: f.id,
				docId: params.id,
				message: `Job ${doc.controlNumber} Claro work order uploaded. Ready for LC request.`,
			})),
		})
	}

	throw redirect(`/docs/${params.id}`)
}

export default function ReviewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, photos, supervisor } = loaderData
	const estimated = (doc.estimatedMaterials as any[]) || []
	const taken = (doc.materialsTaken as any[]) || []
	const used = (doc.materialsUsed as any[]) || []
	const isApproved = [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_GENERATED",
	].includes(doc.status)

	// Build Claro submission helper data
	const codeMap = Object.fromEntries(
		(serviceCodes as any[]).map((c: any) => [c.id, c]),
	)
	const takenItems = taken.map((t: any) => {
		const code = codeMap[t.serviceCodeId]
		return {
			claroCode: code?.claroCode,
			name: code?.name,
			qty: t.qty,
			unit: code?.unit,
		}
	})

	// Extract basenames for photos in JSX (avoid path module in client bundle)
	const photoItems = photos.map((p) => ({
		id: p.id,
		basename: path.basename(p.localPath),
	}))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">Supervisor Review</h1>
			<p className="font-mono text-sm text-slate-500">
				{(doc as any).controlNumber}
			</p>

			{/* Materials variance */}
			<div className="grid grid-cols-3 gap-3 text-sm">
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">Estimated</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={estimated}
						readOnly
					/>
				</div>
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">Taken (Signed)</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={taken}
						readOnly
					/>
				</div>
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">Used (Field)</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={used}
						readOnly
					/>
				</div>
			</div>

			{/* Job address comparison */}
			<div className="bg-white border rounded-lg p-4 text-sm space-y-1">
				<p>
					<span className="text-slate-500">Estimated address:</span>{" "}
					{(doc as any).jobAddressEstimated}
				</p>
				{(doc as any).jobAddressActual && (
					<p>
						<span className="text-slate-500">Actual address:</span>{" "}
						{(doc as any).jobAddressActual}
					</p>
				)}
				{(doc as any).fieldNotes && (
					<p>
						<span className="text-slate-500">Field notes:</span>{" "}
						{(doc as any).fieldNotes}
					</p>
				)}
			</div>

			{/* Inline photos */}
			{photoItems.length > 0 && (
				<div className="bg-white border rounded-lg p-4">
					<p className="text-sm font-medium mb-2">
						Job Photos ({photoItems.length})
					</p>
					<div className="grid grid-cols-3 gap-2">
						{photoItems.map((p) => (
							<a
								key={p.id}
								href={`/files/photos/${(doc as any).id}/${p.basename}`}
								target="_blank"
								rel="noreferrer"
							>
								<img
									src={`/files/photos/${(doc as any).id}/${p.basename}`}
									alt="Job site"
									className="w-full h-24 object-cover rounded border"
								/>
							</a>
						))}
					</div>
				</div>
			)}

			{/* Claro submission helper */}
			<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
				<h2 className="text-sm font-semibold text-blue-900 mb-2">
					Claro Portal — Submission Data
				</h2>
				<p className="text-xs text-blue-700 mb-3">
					Copy this data into Claro's portal to create the work order.
				</p>
				<div className="space-y-1 text-sm">
					<p>
						<span className="font-medium">Aviso #:</span>{" "}
						{(doc as any).avisoNumber ?? "— (enter after creating in Claro)"}
					</p>
					<p>
						<span className="font-medium">Job Type:</span>{" "}
						{(doc as any).jobType}
					</p>
					<p>
						<span className="font-medium">Address:</span>{" "}
						{(doc as any).jobAddressActual ?? (doc as any).jobAddressEstimated}
					</p>
					<p>
						<span className="font-medium">Supervisor:</span> {supervisor?.name}
					</p>
				</div>
				{takenItems.length > 0 && (
					<table className="w-full text-xs mt-3 border-collapse">
						<thead>
							<tr className="text-left text-blue-800 border-b border-blue-200">
								<th className="pb-1">Code</th>
								<th className="pb-1">Description</th>
								<th className="pb-1 text-right">Qty</th>
								<th className="pb-1 text-right">Unit</th>
							</tr>
						</thead>
						<tbody>
							{takenItems.map((item: any) => (
								<tr
									key={item.claroCode ?? item.name}
									className="border-b border-blue-100"
								>
									<td className="py-1 font-mono">{item.claroCode}</td>
									<td className="py-1">{item.name}</td>
									<td className="py-1 text-right">{item.qty}</td>
									<td className="py-1 text-right">{item.unit}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{!isApproved && (
				<Form
					method="post"
					className="space-y-3 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">Approve Job</h2>
					<div>
						<Label htmlFor="avisoNumber">Claro Aviso # (confirm or add)</Label>
						<Input
							id="avisoNumber"
							name="avisoNumber"
							defaultValue={(doc as any).avisoNumber || ""}
						/>
					</div>
					<div>
						<Label htmlFor="claroNotes">Notes for Lissette</Label>
						<Textarea id="claroNotes" name="claroNotes" rows={2} />
					</div>
					<input type="hidden" name="intent" value="approve" />
					<Button type="submit" className="w-full">
						Approve
					</Button>
				</Form>
			)}

			{doc.status === "SUPERVISOR_APPROVED" && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="space-y-3 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">Upload Claro Work Order PDF</h2>
					<p className="text-xs text-slate-500">
						After creating the work order in Claro's portal, download the PDF
						and upload it here.
					</p>
					<input type="hidden" name="intent" value="upload_claro" />
					<Input
						type="file"
						name="claroPdf"
						accept="application/pdf"
						required
					/>
					{(actionData as any)?.error && (
						<p className="text-sm text-red-600">{(actionData as any).error}</p>
					)}
					<Button type="submit">Upload Claro PDF</Button>
				</Form>
			)}
		</div>
	)
}
