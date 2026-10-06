import fs from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
import { useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { data, Form, redirect, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServiceLinesTable } from "~/components/service-lines-table"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { useOnline } from "~/hooks/use-online"
import { isUnassignedCrew } from "~/lib/crew-scope"
import { db } from "~/lib/db.server"
import { queueFieldUpdate } from "~/lib/field-sync"
import {
	type AddressCorrection,
	buildAddressCorrection,
	formatTimeOnSite,
	mergeAddressCorrections,
	parseGpsCoordinates,
} from "~/lib/field-update-helpers"
import { validateFile } from "~/lib/file-upload.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import type { ServiceLine } from "~/lib/service-lines"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.field"

type MaterialLine = { serviceCodeId: string; qty: number }

type SendBackEntry = {
	createdAt: string
	byUserId: string
	fromStatus: string
	toStatus: string
	note: string
}

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Field Update — JAF Ops`
			: "JAF Ops",
	},
]

function buildQuantityDiscrepancies(
	taken: MaterialLine[],
	used: MaterialLine[],
): { serviceCodeId: string; takenQty: number; usedQty: number }[] {
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))
	const allIds = Array.from(
		new Set([...Object.keys(takenMap), ...Object.keys(usedMap)]),
	)
	return allIds
		.map((serviceCodeId) => {
			const takenQty = takenMap[serviceCodeId] ?? 0
			const usedQty = usedMap[serviceCodeId] ?? 0
			return { serviceCodeId, takenQty, usedQty }
		})
		.filter((d) => d.takenQty !== d.usedQty)
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["CREW", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role))
		throw redirect(`/docs/${params.id}`)
	if (isUnassignedCrew(user, doc)) throw redirect(`/docs/${params.id}`)
	const serviceCodes = await getActiveMaterialCodes()
	const sendBackHistory =
		(doc.sendBackHistory as unknown as SendBackEntry[] | null) ?? []
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
	if (!canTransition(doc.status, "FIELD_UPDATED", user.role)) {
		if (request.headers.get("X-Offline-Sync") === "true") {
			return data(
				{ conflict: doc.status === "CANCELLED" ? "CANCELLED" : "REASSIGNED" },
				{ status: 409 },
			)
		}
		throw redirect(`/docs/${params.id}`)
	}
	if (isUnassignedCrew(user, doc)) {
		if (request.headers.get("X-Offline-Sync") === "true") {
			return data({ conflict: "REASSIGNED" }, { status: 409 })
		}
		throw redirect(`/docs/${params.id}`)
	}

	const form = await request.formData()
	// Signed quantities are immutable after pickup. Ignore any attempt to overwrite them.
	form.delete("materialsTaken")
	const jobAddressActual = (form.get("jobAddressActual") as string).trim()
	const fieldNotes = (form.get("fieldNotes") as string | null)?.trim() || null
	const discrepancyNote =
		(form.get("discrepancyNote") as string | null)?.trim() || null
	const materialsRaw = form.get("materialsUsed") as string
	const completionSignature = form.get("completionSignature") as string
	const startedAtRaw = form.get("startedAt") as string | null
	const endedAtRaw = form.get("endedAt") as string | null
	const gpsRaw = form.get("gpsCoordinates") as string | null

	if (!completionSignature || completionSignature === "data:,") {
		return { errorKey: "docs_field.errors.completion_signature_required" }
	}

	let materialsUsed: MaterialLine[] = []
	try {
		materialsUsed = JSON.parse(materialsRaw).filter(
			(i: MaterialLine) => i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_field.errors.invalid_materials" }
	}

	// Zero is a legitimate installed quantity, so this does not use
	// parseServiceLines, which drops zeros.
	let installedServiceLines: ServiceLine[] | undefined
	const installedRaw = form.get("installedServiceLines") as string | null
	if (installedRaw !== null) {
		try {
			const parsed = JSON.parse(installedRaw) as {
				serviceCodeId?: unknown
				claroCode?: unknown
				accountCode?: unknown
				name?: unknown
				qty?: unknown
			}[]
			installedServiceLines = parsed
				.filter(
					(l) => l && typeof l.serviceCodeId === "string" && Number(l.qty) >= 0,
				)
				.map((l) => ({
					serviceCodeId: String(l.serviceCodeId),
					claroCode: String(l.claroCode ?? ""),
					accountCode: l.accountCode ? String(l.accountCode) : null,
					name: String(l.name ?? ""),
					qty: Number(l.qty),
				}))
		} catch {
			return { errorKey: "docs_field.errors.invalid_service_lines" }
		}
	}

	const taken = (doc.materialsTaken as MaterialLine[] | null) ?? []

	const quantityDiscrepancies = buildQuantityDiscrepancies(taken, materialsUsed)
	const hasQuantityDiscrepancy = quantityDiscrepancies.length > 0
	if (hasQuantityDiscrepancy && !discrepancyNote) {
		return { errorKey: "docs_field.errors.discrepancy_note_required" }
	}

	// Handle photo uploads
	const photosBefore = form.getAll("photosBefore") as File[]
	const photosAfter = form.getAll("photosAfter") as File[]
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const photoDir = path.join(uploadDir, "photos", params.id)

	const allPhotos = [
		...photosBefore.map((file) => ({ file, tag: "BEFORE" as const })),
		...photosAfter.map((file) => ({ file, tag: "AFTER" as const })),
	]

	for (const { file } of allPhotos) {
		if (file.size === 0) continue
		const validation = validateFile(file, "photo")
		if (!validation.valid) return { errorMessage: validation.error }
	}

	const photoPaths: { path: string; tag: "BEFORE" | "AFTER" }[] = []
	if (allPhotos.some((p) => p.file.size > 0)) {
		await fs.mkdir(photoDir, { recursive: true })
		for (const { file, tag } of allPhotos) {
			if (file.size === 0) continue
			const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
			const localPath = path.join(photoDir, filename)
			await fs.writeFile(localPath, Buffer.from(await file.arrayBuffer()))
			photoPaths.push({ path: localPath, tag })
		}
	}

	// Address correction history
	const previousActual = doc.jobAddressActual || doc.jobAddressEstimated
	const addressCorrections = mergeAddressCorrections({
		existing: doc.addressCorrections as AddressCorrection[] | null,
		correction: buildAddressCorrection({
			original: previousActual,
			corrected: jobAddressActual,
			correctedById: user.id,
			gps: parseGpsCoordinates(gpsRaw),
		}),
	})

	const startedAt = startedAtRaw ? new Date(startedAtRaw) : undefined
	const endedAt = endedAtRaw ? new Date(endedAtRaw) : undefined

	const ops: Prisma.PrismaPromise<unknown>[] = [
		...photoPaths.map(({ path, tag }) =>
			db.photo.create({
				data: { docId: params.id, uploadedById: user.id, localPath: path, tag },
			}),
		),
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "FIELD_UPDATED",
				jobAddressActual,
				addressCorrections,
				gpsCoordinates: parseGpsCoordinates(gpsRaw),
				materialsUsed,
				installedServiceLines,
				fieldNotes,
				startedAt,
				endedAt,
				completionSignature,
				completedById: user.id,
				completionSignedAt: new Date(),
				completedAt: new Date(),
				fieldSubmittedAt: new Date(),
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
					installedServiceLines,
					startedAt: startedAtRaw,
					endedAt: endedAtRaw,
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
	]

	if (hasQuantityDiscrepancy) {
		ops.push(
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "QUANTITY_DISCREPANCY",
					diffJson: {
						discrepancies: quantityDiscrepancies,
						note: discrepancyNote,
						blocksFinance: false,
					},
				},
			}),
		)
	}

	await db.$transaction(ops)

	throw redirect(`/docs/${params.id}`)
}

export default function FieldUpdate({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, latestSendBack, sentByName } = loaderData
	const taken = (doc.materialsTaken as MaterialLine[] | null) ?? []
	const used = (doc.materialsUsed as MaterialLine[] | null) ?? []
	const estimated = (doc.estimatedMaterials as MaterialLine[] | null) ?? []
	const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
	const corrections =
		(doc.addressCorrections as AddressCorrection[] | null) || []
	const { t } = useTranslation()
	const error = actionData as
		| {
				errorKey?: ParseKeys
				errorParams?: Record<string, string>
				errorMessage?: string
		  }
		| undefined
	const online = useOnline()
	const submit = useSubmit()
	const [queued, setQueued] = useState(false)

	const signatureRef = useRef<SignaturePadHandle>(null)
	const [startedAt, setStartedAt] = useState<string | null>(
		(doc.startedAt ? new Date(doc.startedAt).toISOString() : null) ??
			new Date().toISOString(),
	)
	const [endedAt, setEndedAt] = useState<string | null>(
		doc.endedAt ? new Date(doc.endedAt).toISOString() : null,
	)
	const [gpsCoordinates, setGpsCoordinates] = useState<string | null>(
		doc.gpsCoordinates ? JSON.stringify(doc.gpsCoordinates) : null,
	)
	const [gpsError, setGpsError] = useState<string | null>(null)

	function handleCaptureGps() {
		setGpsError(null)
		if (!navigator.geolocation) {
			setGpsError(t("docs_field.gps_not_supported"))
			return
		}
		navigator.geolocation.getCurrentPosition(
			(position) => {
				setGpsCoordinates(
					JSON.stringify({
						lat: position.coords.latitude,
						lng: position.coords.longitude,
						accuracy: position.coords.accuracy,
						capturedAt: new Date().toISOString(),
					}),
				)
			},
			(err) => {
				setGpsError(t("docs_field.gps_error", { code: err.code }))
			},
		)
	}

	function handleStart() {
		setStartedAt(new Date().toISOString())
	}

	function handleStop() {
		setEndedAt(new Date().toISOString())
	}

	const timeOnSite = formatTimeOnSite(startedAt, endedAt)

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = e.currentTarget
		const signature = signatureRef.current?.toDataURL()
		if (!signature || signature === "data:,") {
			alert(t("docs_field.errors.completion_signature_required"))
			return
		}

		const formData = new FormData(form)
		formData.set("completionSignature", signature)

		if (online) {
			submit(formData, { method: "post", encType: "multipart/form-data" })
			return
		}

		// Offline: queue the field update.
		const photosBefore: { name: string; base64: string; type: string }[] = []
		const photosAfter: { name: string; base64: string; type: string }[] = []
		const beforeInputs = formData.getAll("photosBefore") as File[]
		const afterInputs = formData.getAll("photosAfter") as File[]
		for (const file of beforeInputs) {
			if (file.size === 0) continue
			photosBefore.push({
				name: file.name,
				type: file.type,
				base64: await fileToBase64(file),
			})
		}
		for (const file of afterInputs) {
			if (file.size === 0) continue
			photosAfter.push({
				name: file.name,
				type: file.type,
				base64: await fileToBase64(file),
			})
		}

		await queueFieldUpdate(doc.id, {
			jobAddressActual: (formData.get("jobAddressActual") as string).trim(),
			fieldNotes: (formData.get("fieldNotes") as string | null)?.trim() || null,
			discrepancyNote:
				(formData.get("discrepancyNote") as string | null)?.trim() || null,
			materialsUsed: formData.get("materialsUsed") as string,
			installedServiceLines:
				(formData.get("installedServiceLines") as string) || null,
			completionSignature: signature,
			startedAt: (formData.get("startedAt") as string) || null,
			endedAt: (formData.get("endedAt") as string) || null,
			gpsCoordinates: (formData.get("gpsCoordinates") as string) || null,
			photosBefore,
			photosAfter,
		})
		setQueued(true)
	}

	return (
		<div className="space-y-5">
			<div className="bg-status-info-soft border border-status-info/30 rounded-lg p-3 text-sm text-status-info">
				<Trans
					i18nKey="docs_field.offline_notice"
					components={{ strong: <strong /> }}
				/>
			</div>

			{latestSendBack && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-3 text-sm">
					<p className="font-medium text-status-warn">
						{t("docs_field.sent_back_by", {
							name: sentByName ?? t("docs_field.sent_back_by_unknown"),
						})}
					</p>
					<p className="mt-1 text-status-warn">{latestSendBack.note}</p>
					<p className="mt-1 text-xs text-status-warn/80">
						{new Date(latestSendBack.createdAt).toLocaleString()}
					</p>
				</div>
			)}

			<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
			<p className="text-sm font-mono text-muted-foreground">
				{doc.controlNumber}
			</p>

			{corrections.length > 0 && (
				<div className="bg-muted border rounded-lg p-3 text-sm space-y-2">
					<p className="font-medium text-foreground">
						{t("docs_field.address_history_heading")}
					</p>
					<ul className="space-y-1">
						{corrections.map((c) => (
							<li
								key={`${c.original}-${c.corrected}-${c.correctedAt}`}
								className="text-xs text-muted-foreground"
							>
								<span className="line-through">{c.original}</span>
								{" → "}
								<span className="font-medium">{c.corrected}</span>
								{c.gps && (
									<span className="ml-1 text-muted-foreground">
										({c.gps.lat.toFixed(4)}, {c.gps.lng.toFixed(4)})
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{queued && (
				<div className="bg-status-ok-soft border border-status-ok/30 rounded-lg p-3 text-sm text-status-ok">
					{t("docs_field.queued_message")}
				</div>
			)}

			{!online && !queued && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-3 text-sm text-status-warn">
					{t("docs_field.offline_submit_notice")}
				</div>
			)}

			<Form
				method="post"
				encType="multipart/form-data"
				className="space-y-4"
				onSubmit={handleSubmit}
			>
				<div>
					<Label htmlFor="jobAddressActual">
						{t("docs_field.actual_address_label")}
					</Label>
					<Input
						id="jobAddressActual"
						name="jobAddressActual"
						defaultValue={doc.jobAddressActual || doc.jobAddressEstimated}
						required
					/>
				</div>

				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleCaptureGps}
						disabled={!!gpsCoordinates}
					>
						{gpsCoordinates
							? t("docs_field.gps_captured")
							: t("docs_field.gps_capture")}
					</Button>
					{gpsError && (
						<p className="text-xs text-status-danger mt-1">{gpsError}</p>
					)}
					{gpsCoordinates && (
						<p className="text-xs text-muted-foreground mt-1">
							{t("docs_field.gps_saved")}
						</p>
					)}
					<input
						type="hidden"
						name="gpsCoordinates"
						value={gpsCoordinates ?? ""}
					/>
				</div>

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.time_on_site_label")}</Label>
					<div className="flex items-center gap-2">
						<input type="hidden" name="startedAt" value={startedAt ?? ""} />
						<input type="hidden" name="endedAt" value={endedAt ?? ""} />
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleStart}
							disabled={!!startedAt}
						>
							{t("docs_field.start_timer")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleStop}
							disabled={!startedAt || !!endedAt}
						>
							{t("docs_field.stop_timer")}
						</Button>
						{timeOnSite && (
							<span className="text-sm font-medium text-foreground">
								{t("docs_field.time_on_site_value", { duration: timeOnSite })}
							</span>
						)}
					</div>
				</div>

				{ordered.length > 0 && (
					<div className="border rounded-lg p-3 space-y-2">
						<Label>{t("docs_field.services_performed_label")}</Label>
						<p className="text-xs text-muted-foreground">
							{t("docs_field.services_performed_hint")}
						</p>
						<ServiceLinesTable
							lines={ordered}
							installed={
								(doc.installedServiceLines as ServiceLine[] | null) ?? undefined
							}
							editableName="installedServiceLines"
						/>
					</div>
				)}

				<div className="border rounded-lg p-3 space-y-3">
					<Label>{t("docs_field.materials_used_label")}</Label>
					<p className="text-xs text-muted-foreground">
						{t("docs_field.materials_used_hint")}
					</p>
					{taken.length > 0 && (
						<div className="bg-muted rounded p-2">
							<p className="text-xs font-medium text-muted-foreground mb-1">
								{t("docs_field.taken_reference_label")}
							</p>
							<MaterialLineItems
								serviceCodes={serviceCodes}
								initialItems={taken}
								readOnly
							/>
						</div>
					)}
					<div>
						<p className="text-xs font-medium text-muted-foreground mb-1">
							{t("docs_field.used_entry_label")}
						</p>
						<MaterialLineItems
							serviceCodes={serviceCodes}
							initialItems={used.length > 0 ? used : taken}
							name="materialsUsed"
						/>
					</div>
					{estimated.length > 0 && (
						<p className="text-xs text-muted-foreground">
							{t("docs_field.ordered_vs_installed_hint")}
						</p>
					)}
				</div>

				<div>
					<Label htmlFor="discrepancyNote">
						{t("docs_field.discrepancy_note_label")}
					</Label>
					<p className="text-xs text-muted-foreground mb-1">
						{t("docs_field.discrepancy_note_hint")}
					</p>
					<Textarea
						id="discrepancyNote"
						name="discrepancyNote"
						rows={2}
						placeholder={t("docs_field.discrepancy_note_placeholder")}
						defaultValue=""
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
						defaultValue={doc.fieldNotes ?? ""}
					/>
				</div>

				<div>
					<Label>{t("docs_field.photos_before_label")}</Label>
					<p className="text-xs text-muted-foreground mb-1">
						{t("docs_field.photos_before_hint")}
					</p>
					<input
						id="photosBefore"
						name="photosBefore"
						type="file"
						accept="image/*"
						multiple
						capture="environment"
						className="block w-full text-sm text-muted-foreground mt-1"
					/>
				</div>
				<div>
					<Label>{t("docs_field.photos_after_label")}</Label>
					<p className="text-xs text-muted-foreground mb-1">
						{t("docs_field.photos_after_hint")}
					</p>
					<input
						id="photosAfter"
						name="photosAfter"
						type="file"
						accept="image/*"
						multiple
						capture="environment"
						className="block w-full text-sm text-muted-foreground mt-1"
					/>
				</div>

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.completion_signature_label")}</Label>
					<p className="text-xs text-muted-foreground">
						{t("docs_field.completion_signature_hint")}
					</p>
					<SignaturePad ref={signatureRef} width={320} height={120} />
					<button
						type="button"
						onClick={() => signatureRef.current?.clear()}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						{t("docs_field.clear_signature")}
					</button>
				</div>

				{error?.errorKey && (
					<p className="text-sm text-status-danger">
						{t(error.errorKey, error.errorParams)}
					</p>
				)}
				{error?.errorMessage && (
					<p className="text-sm text-status-danger">{error.errorMessage}</p>
				)}

				<Button type="submit" className="w-full">
					{online ? t("docs_field.submit") : t("docs_field.save_offline")}
				</Button>
			</Form>
		</div>
	)
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = reject
		reader.readAsDataURL(file)
	})
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
