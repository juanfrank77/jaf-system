import fs from "node:fs/promises"
import path from "node:path"
import { Form, redirect } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id_.field"

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["CREW", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	return { doc, user, serviceCodes }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["CREW", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role))
		throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	const jobAddressActual = (form.get("jobAddressActual") as string).trim()
	const fieldNotes = (form.get("fieldNotes") as string | null)?.trim() || null
	const materialsRaw = form.get("materialsUsed") as string

	let materialsUsed: { serviceCodeId: string; qty: number }[] = []
	try {
		materialsUsed = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { error: "Invalid materials data" }
	}

	// Enforce materialsUsed <= materialsTaken
	const taken =
		(doc.materialsTaken as { serviceCodeId: string; qty: number }[]) || []
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	for (const item of materialsUsed) {
		if ((takenMap[item.serviceCodeId] ?? 0) < item.qty) {
			return {
				error: `Cannot use more than taken for service code ${item.serviceCodeId}`,
			}
		}
	}

	// Handle photo uploads
	const photos = form.getAll("photos") as File[]
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const photoDir = path.join(uploadDir, "photos", params.id)
	if (photos.length > 0 && photos[0].size > 0) {
		await fs.mkdir(photoDir, { recursive: true })
		for (const photo of photos) {
			if (photo.size === 0) continue
			const filename = `${Date.now()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
			const localPath = path.join(photoDir, filename)
			await fs.writeFile(localPath, Buffer.from(await photo.arrayBuffer()))
			await db.photo.create({
				data: { docId: params.id, uploadedById: user.id, localPath },
			})
		}
	}

	await db.jafInvoice.update({
		where: { id: params.id },
		data: {
			status: "FIELD_UPDATED",
			jobAddressActual,
			materialsUsed,
			fieldNotes,
			completedAt: new Date(),
		},
	})

	await db.auditTrail.create({
		data: {
			docId: params.id,
			userId: user.id,
			action: "STATUS_CHANGED",
			// before: doc.status (dynamic) — handles both SIGNED→FIELD_UPDATED and CREATED→FIELD_UPDATED
			diffJson: {
				status: { before: doc.status, after: "FIELD_UPDATED" },
				jobAddressActual,
				materialsUsed,
			},
		},
	})

	// Notify supervisor
	await db.notification.create({
		data: {
			userId: doc.supervisorId,
			docId: params.id,
			message: `Job ${doc.controlNumber} marked complete by crew. Ready for your review.`,
		},
	})

	throw redirect(`/docs/${params.id}`)
}

export default function FieldUpdate({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes } = loaderData
	const taken = (doc.materialsTaken as any[]) || []

	return (
		<div className="space-y-5">
			<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
				<strong>Offline capable.</strong> If you lose connection, your changes
				save locally and sync when you reconnect.
			</div>

			<h1 className="text-xl font-semibold">Field Update</h1>
			<p className="text-sm font-mono text-slate-500">
				{(doc as any).controlNumber}
			</p>

			<Form method="post" encType="multipart/form-data" className="space-y-4">
				<div>
					<Label htmlFor="jobAddressActual">Actual Job Address</Label>
					<Input
						id="jobAddressActual"
						name="jobAddressActual"
						defaultValue={(doc as any).jobAddressEstimated}
						required
					/>
				</div>

				<div>
					<Label>Materials Used</Label>
					<p className="text-xs text-slate-500 mb-1">
						Cannot exceed what was signed out at warehouse.
					</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={taken}
						name="materialsUsed"
					/>
				</div>

				<div>
					<Label htmlFor="fieldNotes">Field Notes</Label>
					<Textarea
						id="fieldNotes"
						name="fieldNotes"
						rows={3}
						placeholder="Observations, issues, changes..."
					/>
				</div>

				<div>
					<Label htmlFor="photos">Photos</Label>
					<input
						id="photos"
						name="photos"
						type="file"
						accept="image/*"
						multiple
						capture="environment"
						className="block w-full text-sm text-slate-500 mt-1"
					/>
					<p className="text-xs text-slate-400 mt-1">
						Photos are source data for the supervisor's Claro submission —
						stored on server.
					</p>
				</div>

				{(actionData as any)?.error && (
					<p className="text-sm text-red-600">{(actionData as any).error}</p>
				)}

				<Button type="submit" className="w-full">
					Mark Complete
				</Button>
			</Form>
		</div>
	)
}
