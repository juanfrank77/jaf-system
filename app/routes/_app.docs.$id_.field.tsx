import fs from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useNavigation, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { JobStepRail } from "~/components/job-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { type CapturedPhoto, PhotoCapture } from "~/components/photo-capture"
import { ServiceLinesTable } from "~/components/service-lines-table"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
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
import {
	getQueuedActions,
	type QueuedAction,
	removeQueuedAction,
} from "~/lib/offline-store"
import { refuse } from "~/lib/offline-validation.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { ServiceLine } from "~/lib/service-lines"
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

function exceedsTaken(taken: MaterialLine[], used: MaterialLine[]): boolean {
	const takenMap = new Map(taken.map((t) => [t.serviceCodeId, t.qty]))
	return used.some((u) => u.qty > (takenMap.get(u.serviceCodeId) ?? 0))
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
	// Names for whoever edited the address, so the history can say who.
	const correctorIds = [
		...new Set(
			((doc.addressCorrections as AddressCorrection[] | null) ?? []).map(
				(c) => c.correctedById,
			),
		),
	]
	const correctors =
		correctorIds.length > 0
			? await db.user.findMany({
					where: { id: { in: correctorIds } },
					select: { id: true, name: true },
				})
			: []
	return {
		doc,
		user,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		correctorNames: Object.fromEntries(correctors.map((u) => [u.id, u.name])),
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
		return refuse(request, {
			errorKey: "docs_field.errors.completion_signature_required" as const,
		})
	}

	let materialsUsed: MaterialLine[] = []
	try {
		materialsUsed = JSON.parse(materialsRaw).filter(
			(i: MaterialLine) => i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return refuse(request, {
			errorKey: "docs_field.errors.invalid_materials" as const,
		})
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
			return refuse(request, {
				errorKey: "docs_field.errors.invalid_service_lines" as const,
			})
		}
	}

	const taken = (doc.materialsTaken as MaterialLine[] | null) ?? []

	// A crew cannot use more of a code than it signed out at pickup.
	if (exceedsTaken(taken, materialsUsed)) {
		return refuse(request, {
			errorKey: "docs_field.errors.used_exceeds_took" as const,
		})
	}

	const quantityDiscrepancies = buildQuantityDiscrepancies(taken, materialsUsed)
	const hasQuantityDiscrepancy = quantityDiscrepancies.length > 0
	if (hasQuantityDiscrepancy && !discrepancyNote) {
		return refuse(request, {
			errorKey: "docs_field.errors.discrepancy_note_required" as const,
		})
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
		if (!validation.valid)
			return refuse(request, { errorMessage: validation.error })
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
	const {
		doc,
		serviceCodes,
		user,
		latestSendBack,
		sentByName,
		correctorNames,
	} = loaderData
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
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const [queued, setQueued] = useState(false)
	// An offline update for this job that the server refused on validation.
	const [rejected, setRejected] = useState<QueuedAction[]>([])
	useEffect(() => {
		getQueuedActions()
			.then((all) =>
				setRejected(all.filter((a) => a.docId === doc.id && a.rejection)),
			)
			.catch(() => {})
	}, [doc.id])
	// Client-side check shown inline (an alert() is a modal OS dialog in the
	// installed app and the message is gone as soon as it is dismissed).
	const [clientErrorKey, setClientErrorKey] = useState<ParseKeys | null>(null)
	const errorRef = useRef<HTMLDivElement>(null)

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
	const [photosBefore, setPhotosBefore] = useState<CapturedPhoto[]>([])
	const [photosAfter, setPhotosAfter] = useState<CapturedPhoto[]>([])
	const [usedItems, setUsedItems] = useState<MaterialLine[]>(
		used.length > 0 ? used : taken,
	)

	// The address the server will diff against on submit (see the action).
	const baselineAddress = doc.jobAddressActual || doc.jobAddressEstimated
	const [address, setAddress] = useState(baselineAddress)
	const addressChanged = address.trim() !== baselineAddress.trim()

	const shownErrorKey = clientErrorKey ?? error?.errorKey
	const shownErrorMessage = clientErrorKey ? undefined : error?.errorMessage
	const hasError = Boolean(shownErrorKey || shownErrorMessage)
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when an error appears or changes
	useEffect(() => {
		if (hasError)
			errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
	}, [hasError, shownErrorKey, shownErrorMessage, error])

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

	// What the crew still has to bring back: signed out minus used.
	const usedById = new Map(usedItems.map((i) => [i.serviceCodeId, i.qty]))
	const bringBack = taken
		.map((line) => {
			const code = serviceCodes.find((c) => c.id === line.serviceCodeId)
			return {
				id: line.serviceCodeId,
				qty: line.qty - (usedById.get(line.serviceCodeId) ?? 0),
				name: code?.name ?? "",
				unit: code?.unit ?? "",
			}
		})
		.filter((line) => line.qty > 0)

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = e.currentTarget
		const signature = signatureRef.current?.toDataURL()
		if (!signature || signatureRef.current?.isEmpty()) {
			setClientErrorKey("docs_field.errors.completion_signature_required")
			return
		}
		setClientErrorKey(null)
		// Sending again replaces the refused offline update.
		if (rejected.length > 0) {
			await Promise.all(
				rejected.map((r) => removeQueuedAction(r.id).catch(() => {})),
			)
			setRejected([])
		}

		const formData = new FormData(form)
		formData.set("completionSignature", signature)
		// The photos live in component state (thumbnails, remove), not in a file input.
		formData.delete("photosBefore")
		formData.delete("photosAfter")
		for (const p of photosBefore)
			formData.append("photosBefore", p.file, p.file.name)
		for (const p of photosAfter)
			formData.append("photosAfter", p.file, p.file.name)

		if (online) {
			submit(formData, { method: "post", encType: "multipart/form-data" })
			return
		}

		// Offline: queue the field update.
		const queuedBefore: { name: string; base64: string; type: string }[] = []
		const queuedAfter: { name: string; base64: string; type: string }[] = []
		for (const file of formData.getAll("photosBefore") as File[]) {
			if (file.size === 0) continue
			queuedBefore.push({
				name: file.name,
				type: file.type,
				base64: await fileToBase64(file),
			})
		}
		for (const file of formData.getAll("photosAfter") as File[]) {
			if (file.size === 0) continue
			queuedAfter.push({
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
			photosBefore: queuedBefore,
			photosAfter: queuedAfter,
		})
		setQueued(true)
	}

	return (
		<div className="space-y-5">
			<div className="flex items-start justify-between gap-2">
				<div>
					<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
					<p className="text-sm font-mono text-muted-foreground">
						{doc.controlNumber}
					</p>
				</div>
				<Badge variant="info" className="shrink-0">
					{t("docs_field.status_pill")}
				</Badge>
			</div>

			{latestSendBack && (
				<Callout
					tone="danger"
					title={t("docs_field.sent_back_by", {
						name: sentByName ?? t("docs_field.sent_back_by_unknown"),
					})}
				>
					{latestSendBack.note}{" "}
					<span className="text-xs opacity-80">
						{new Date(latestSendBack.createdAt).toLocaleString()}
					</span>
				</Callout>
			)}

			<JobStepRail docId={doc.id} current="FIELD" role={user.role} />
			<Callout title={t("job_flow.callout.field_title")}>
				{t("job_flow.callout.field_body")}
			</Callout>

			{rejected.length > 0 && (
				<Callout tone="danger" title={t("docs_field.rejected_offline_title")}>
					<ul className="list-disc pl-4">
						{rejected.map((r) => (
							<li key={r.id}>
								{r.rejection?.errorKey
									? t(r.rejection.errorKey as ParseKeys)
									: r.rejection?.message}
							</li>
						))}
					</ul>
					{t("docs_field.rejected_offline_hint")}
				</Callout>
			)}

			{queued && (
				<Callout tone="ok" title={t("docs_field.queued_title")}>
					{t("docs_field.queued_message")}
				</Callout>
			)}

			{!online && !queued && (
				<Callout tone="warn" title={t("docs_field.offline_submit_title")}>
					{t("docs_field.offline_submit_notice")}
				</Callout>
			)}

			<Form
				method="post"
				encType="multipart/form-data"
				className="space-y-4"
				onSubmit={handleSubmit}
			>
				<div className="border rounded-lg p-3 space-y-3">
					<div className="space-y-1">
						<Label htmlFor="jobAddressActual">
							{t("docs_field.actual_address_label")}
						</Label>
						<Input
							id="jobAddressActual"
							name="jobAddressActual"
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							className="h-11 text-base"
							required
						/>
					</div>

					{addressChanged && (
						<div
							data-testid="address-diff"
							className="rounded-lg bg-status-info-soft p-2.5 text-sm"
						>
							<p className="break-words">
								<span className="text-muted-foreground line-through">
									{baselineAddress}
								</span>
								{" → "}
								<b>{address.trim()}</b>
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{t("docs_field.address_diff_hint")}
							</p>
						</div>
					)}

					{corrections.length > 0 && (
						<div className="space-y-1">
							<p className="text-xs font-medium text-foreground">
								{t("docs_field.address_history_heading")}
							</p>
							<ul className="space-y-1.5">
								{corrections.map((c) => (
									<li
										key={`${c.original}-${c.corrected}-${c.correctedAt}`}
										className="rounded-lg bg-muted p-2 text-xs"
									>
										<p className="break-words">
											<span className="text-muted-foreground line-through">
												{c.original}
											</span>
											{" → "}
											<span className="font-medium">{c.corrected}</span>
										</p>
										<p className="mt-0.5 text-muted-foreground">
											{t(
												c.correctedById === user.id
													? "docs_field.address_edited_by_you"
													: correctorNames[c.correctedById]
														? "docs_field.address_edited_by_name"
														: "docs_field.address_edited_by_other",
												{
													name: correctorNames[c.correctedById],
													when: new Date(c.correctedAt).toLocaleString([], {
														dateStyle: "short",
														timeStyle: "short",
													}),
												},
											)}
											{c.gps &&
												` · ${t("docs_field.address_gps", {
													lat: c.gps.lat.toFixed(4),
													lng: c.gps.lng.toFixed(4),
												})}`}
										</p>
									</li>
								))}
							</ul>
						</div>
					)}

					<div>
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-11 text-base"
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
				</div>

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.time_on_site_label")}</Label>
					<div className="flex flex-wrap items-center gap-2">
						<input type="hidden" name="startedAt" value={startedAt ?? ""} />
						<input type="hidden" name="endedAt" value={endedAt ?? ""} />
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-11 text-base"
							onClick={handleStart}
							disabled={!!startedAt}
						>
							{t("docs_field.start_timer")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-11 text-base"
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

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.photos_before_label")}</Label>
					<p className="text-xs text-muted-foreground">
						{t("docs_field.photos_before_hint")}
					</p>
					<PhotoCapture
						photos={photosBefore}
						onChange={setPhotosBefore}
						tag={t("docs_field.photo_tag_before")}
					/>
				</div>
				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.photos_after_label")}</Label>
					<p className="text-xs text-muted-foreground">
						{t("docs_field.photos_after_hint")}
					</p>
					<PhotoCapture
						photos={photosAfter}
						onChange={setPhotosAfter}
						tag={t("docs_field.photo_tag_after")}
					/>
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
					<MaterialLineItems
						serviceCodes={serviceCodes}
						initialItems={used.length > 0 ? used : taken}
						name="materialsUsed"
						touch
						estimatedItems={taken.length > 0 ? taken : undefined}
						listedLabel={t("docs_field.took_label")}
						tags={false}
						capToListed={taken.length > 0}
						onItemsChange={setUsedItems}
					/>
					{taken.length > 0 && bringBack.length > 0 && (
						<Callout tone="warn" title={t("docs_field.bring_back_title")}>
							{bringBack
								.map((l) => `${l.qty}${l.unit ? ` ${l.unit}` : ""} ${l.name}`)
								.join(" · ")}
							<span className="mt-0.5 block text-xs text-muted-foreground">
								{t("docs_field.bring_back_hint")}
							</span>
						</Callout>
					)}
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

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.completion_signature_label")}</Label>
					<p className="text-xs text-muted-foreground">
						{t("docs_field.completion_signature_hint")}
					</p>
					<SignaturePad
						ref={signatureRef}
						height={160}
						onChange={(isEmpty) => {
							if (!isEmpty) setClientErrorKey(null)
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="lg"
						className="h-11 text-base"
						onClick={() => signatureRef.current?.clear()}
					>
						{t("docs_field.clear_signature")}
					</Button>
				</div>

				{hasError && (
					<div ref={errorRef} role="alert">
						<Callout tone="danger" title={t("docs_field.error_title")}>
							{shownErrorKey
								? t(shownErrorKey, error?.errorParams)
								: shownErrorMessage}
						</Callout>
					</div>
				)}

				<Button
					type="submit"
					size="lg"
					className="h-12 w-full text-base"
					disabled={busy}
				>
					{busy
						? t("docs_field.submitting")
						: online
							? t("docs_field.submit")
							: t("docs_field.save_offline")}
				</Button>
				<p className="text-center text-xs text-muted-foreground">
					{t("docs_field.offline_footnote")}
				</p>
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
