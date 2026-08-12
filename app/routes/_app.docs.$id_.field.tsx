import fs from "node:fs/promises"
import path from "node:path"
import { Trans, useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.field"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Field Update — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["CREW", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role))
		throw redirect(`/docs/${params.id}`)
	if (user.role === "CREW" && !doc.assignedCrewIds.includes(user.id))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	const sendBackHistory = (doc.sendBackHistory as any[] | null) ?? []
	const latestSendBack =
		sendBackHistory.length > 0
			? sendBackHistory[sendBackHistory.length - 1]
			: null
	const sentBy = latestSendBack
		? await db.user.findUnique({ where: { id: latestSendBack.byUserId } })
		: null
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		latestSendBack,
		sentByName: sentBy?.name ?? null,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["CREW", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role))
		throw redirect(`/docs/${params.id}`)
	if (user.role === "CREW" && !doc.assignedCrewIds.includes(user.id))
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
		return { errorKey: "docs_field.errors.invalid_materials" }
	}

	// Enforce materialsUsed <= materialsTaken
	const taken =
		(doc.materialsTaken as { serviceCodeId: string; qty: number }[]) || []
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	for (const item of materialsUsed) {
		if (taken.length > 0 && (takenMap[item.serviceCodeId] ?? 0) < item.qty) {
			return {
				errorKey: "docs_field.errors.exceeds_taken",
				errorParams: { serviceCodeId: item.serviceCodeId },
			}
		}
	}

	// Handle photo uploads
	const photos = form.getAll("photos") as File[]
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const photoDir = path.join(uploadDir, "photos", params.id)

	for (const photo of photos) {
		if (photo.size === 0) continue
		const validation = validateFile(photo, "photo")
		if (!validation.valid) return { errorMessage: validation.error }
	}

	const photoPaths: string[] = []
	if (photos.some((p) => p.size > 0)) {
		await fs.mkdir(photoDir, { recursive: true })
		for (const photo of photos) {
			if (photo.size === 0) continue
			const filename = `${Date.now()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
			const localPath = path.join(photoDir, filename)
			await fs.writeFile(localPath, Buffer.from(await photo.arrayBuffer()))
			photoPaths.push(localPath)
		}
	}

	await db.$transaction([
		...photoPaths.map((localPath) =>
			db.photo.create({
				data: { docId: params.id, uploadedById: user.id, localPath },
			}),
		),
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "FIELD_UPDATED",
				jobAddressActual,
				materialsUsed,
				fieldNotes,
				completedAt: new Date(),
			},
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: {
					status: { before: doc.status, after: "FIELD_UPDATED" },
					jobAddressActual,
					materialsUsed,
				},
			},
		}),
		db.notification.create({
			data: {
				userId: doc.supervisorId,
				docId: params.id,
				message: `Job ${doc.controlNumber} marked complete by crew. Ready for your review.`,
			},
		}),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

export default function FieldUpdate({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, latestSendBack, sentByName } = loaderData
	const taken = (doc.materialsTaken as any[]) || []
	const { t } = useTranslation()
	const error = actionData as
		| { errorKey?: any; errorParams?: any; errorMessage?: string }
		| undefined

	return (
		<div className="space-y-5">
			<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
				<Trans
					i18nKey="docs_field.offline_notice"
					components={{ strong: <strong /> }}
				/>
			</div>

			{latestSendBack && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
					<p className="font-medium text-amber-900">
						{t("docs_field.sent_back_by", {
							name: sentByName ?? t("docs_field.sent_back_by_unknown"),
						})}
					</p>
					<p className="mt-1 text-amber-800">{latestSendBack.note}</p>
					<p className="mt-1 text-xs text-amber-700/80">
						{new Date(latestSendBack.createdAt).toLocaleString()}
					</p>
				</div>
			)}

			<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
			<p className="text-sm font-mono text-slate-500">
				{(doc as any).controlNumber}
			</p>

			<Form method="post" encType="multipart/form-data" className="space-y-4">
				<div>
					<Label htmlFor="jobAddressActual">
						{t("docs_field.actual_address_label")}
					</Label>
					<Input
						id="jobAddressActual"
						name="jobAddressActual"
						defaultValue={(doc as any).jobAddressEstimated}
						required
					/>
				</div>

				<div>
					<Label>{t("docs_field.materials_used_label")}</Label>
					<p className="text-xs text-slate-500 mb-1">
						{t("docs_field.materials_used_hint")}
					</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={taken}
						name="materialsUsed"
					/>
				</div>

				<div>
					<Label htmlFor="fieldNotes">
						{t("docs_field.field_notes_label")}
					</Label>
					<Textarea
						id="fieldNotes"
						name="fieldNotes"
						rows={3}
						placeholder={t("docs_field.field_notes_placeholder")}
					/>
				</div>

				<div>
					<Label htmlFor="photos">{t("docs_field.photos_label")}</Label>
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
						{t("docs_field.photos_hint")}
					</p>
				</div>

				{error?.errorKey && (
					<p className="text-sm text-red-600">
						{t(error.errorKey, error.errorParams)}
					</p>
				)}
				{error?.errorMessage && (
					<p className="text-sm text-red-600">{error.errorMessage}</p>
				)}

				<Button type="submit" className="w-full">
					{t("docs_field.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
