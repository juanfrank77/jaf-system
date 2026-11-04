import fs from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect, useSubmit } from "react-router"
import { CrewSignerSelect } from "~/components/crew-signer-select"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { JobStepRail } from "~/components/job-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	addTaken,
	type MaterialLine,
	releaseOverages,
	remainingToTake,
} from "~/lib/pickup-release"
import {
	findPickupSigner,
	pickupSignersForDoc,
} from "~/lib/pickup-signer.server"
import {
	getActiveMaterialCodes,
	getActiveServiceCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.sign"

export const meta: Route.MetaFunction = ({ data, matches }) => [
	{
		title: data
			? pageTitle(matches, "page_title.sign", data.doc.controlNumber)
			: pageTitle(matches),
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	// The warehouse (or an admin) runs the counter: crew accounts no longer
	// sign in, so the brigade member signs on this screen, picked from the list.
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await getActiveMaterialCodes()
	const warehouses = await db.warehouse.findMany({ where: { active: true } })
	const warehouseUsers = await db.user.findMany({
		where: { role: "WAREHOUSE", active: true },
		orderBy: { name: "asc" },
	})
	// Anyone on a brigade assigned to the job can pick the materials up; a job
	// with no brigade is a screen error, not a crash.
	const signerGroups = await pickupSignersForDoc(doc)
	const releases = await db.pickupRelease.findMany({
		where: { docId: doc.id },
		orderBy: { number: "asc" },
		select: {
			id: true,
			number: true,
			releasedByName: true,
			crewSignerName: true,
			crewSignerBrigadeName: true,
			crewSignerBrigadeCode: true,
			materials: true,
			createdAt: true,
		},
	})
	return {
		doc,
		user,
		releases,
		// "Listed" is what is still left after earlier releases.
		listed: remainingToTake(
			(doc.estimatedMaterials as MaterialLine[] | null) ?? [],
			(doc.materialsTaken as MaterialLine[] | null) ?? [],
		),
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		warehouses,
		warehouseUsers,
		signerGroups,
		pickupErrorKey:
			signerGroups.length > 0
				? null
				: ("docs_sign.errors.no_pickup_signer" as const),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	// Orlando closes the pickup: the job moves on once a release is signed.
	if (form.get("intent") === "complete") {
		const count = await db.pickupRelease.count({ where: { docId: doc.id } })
		if (count === 0) return { errorKey: "docs_sign.errors.no_release" }
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { status: "SIGNED" },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: doc.status, after: "SIGNED" },
						releases: count,
					},
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}
	const releaseSignature = form.get("releaseSignature") as string
	const crewSignature = form.get("crewSignature") as string
	const warehouseId = form.get("warehouseId") as string
	const releasedById = form.get("releasedById") as string
	const crewSigner = form.get("crewSigner") as string
	const materialsRaw = form.get("materials") as string

	if (!warehouseId) {
		return { errorKey: "docs_sign.errors.warehouse_required" }
	}
	if (!releasedById) {
		return { errorKey: "docs_sign.errors.release_signer_required" }
	}
	const signerGroups = await pickupSignersForDoc(doc)
	if (signerGroups.length === 0) {
		return { errorKey: "docs_sign.errors.no_pickup_signer" }
	}
	const pickup = findPickupSigner(signerGroups, crewSigner)
	if (!pickup) {
		return { errorKey: "docs_sign.errors.crew_signer_invalid" }
	}
	const signerBrigade = signerGroups.find(
		(g) => g.brigadeId === pickup.brigadeId,
	)
	if (!releaseSignature || releaseSignature === "data:,") {
		return { errorKey: "docs_sign.errors.release_signature_required" }
	}
	if (!crewSignature || crewSignature === "data:,") {
		return { errorKey: "docs_sign.errors.crew_signature_required" }
	}

	let materialsTaken: MaterialLine[] = []
	try {
		materialsTaken = JSON.parse(materialsRaw).filter(
			(i: MaterialLine) => i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_sign.errors.invalid_materials" }
	}

	// Signer identity validation
	const [releaseSigner, warehouse] = await Promise.all([
		db.user.findFirst({
			where: { id: releasedById, role: "WAREHOUSE", active: true },
		}),
		db.warehouse.findUnique({ where: { id: warehouseId } }),
	])
	if (!releaseSigner) {
		return { errorKey: "docs_sign.errors.release_signer_invalid" }
	}

	// Each release locks its own quantities; the job's Taken is their total.
	const existingTaken = (doc.materialsTaken as MaterialLine[] | null) ?? []
	const number =
		(await db.pickupRelease.count({ where: { docId: params.id } })) + 1
	// A later release has to take something; the first keeps today's behaviour.
	if (number > 1 && materialsTaken.length === 0)
		return { errorKey: "docs_sign.errors.invalid_materials" }
	const totalTaken = addTaken(existingTaken, materialsTaken)

	const serviceCodes = await getActiveServiceCodes()
	const pdfBytes = await generateWarehouseReceiptPdf(
		{
			...doc,
			materialsTaken,
			releaseSignature,
			crewSignature,
			releaseSignerName: releaseSigner.name,
			crewSignerName: pickup.name,
		},
		serviceCodes.map((c) => ({
			id: c.id,
			claroCode: c.claroCode,
			name: c.name,
			unit: c.unit,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		warehouse?.name ?? "",
	)
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const receiptDir = path.join(uploadDir, "receipts")
	await fs.mkdir(receiptDir, { recursive: true })
	const receiptPath = path.join(
		receiptDir,
		number === 1
			? `${params.id}-receipt.pdf`
			: `${params.id}-receipt-${number}.pdf`,
	)
	await fs.writeFile(receiptPath, pdfBytes)

	const estimatedMaterials =
		(doc.estimatedMaterials as MaterialLine[] | null) ?? []
	const overages = releaseOverages(
		materialsTaken,
		totalTaken,
		estimatedMaterials,
	)
	const hasOverage = overages.length > 0

	// Fetch notify users before transaction (can't query in callback)
	const notifyUsers = hasOverage
		? await db.user.findMany({
				where: {
					active: true,
					OR: [{ id: doc.supervisorId }, { role: "ADMIN" }],
				},
				select: { id: true },
			})
		: []

	await db.$transaction(async (tx) => {
		await tx.pickupRelease.create({
			data: {
				docId: params.id,
				number,
				warehouseId,
				releasedById,
				releasedByName: releaseSigner.name,
				signedById: pickup.userId,
				crewSignerName: pickup.name,
				crewSignerBrigadeId: pickup.brigadeId,
				crewSignerBrigadeName: signerBrigade?.brigadeName ?? null,
				crewSignerBrigadeCode: signerBrigade?.brigadeCode ?? null,
				releaseSignature,
				crewSignature,
				materials: materialsTaken,
				receiptPath,
			},
		})
		// The job keeps the running total, and the first release's signatures for
		// the documents that print one pair.
		await tx.jafInvoice.update({
			where: { id: params.id },
			data: {
				materialsTaken: totalTaken,
				...(number === 1 && {
					warehouseId,
					releaseSignature,
					releasedById,
					releaseSignedAt: new Date(),
					crewSignature,
					signedById: pickup.userId,
					crewSignerName: pickup.name,
					crewSignerBrigadeId: pickup.brigadeId,
					signedAt: new Date(),
					warehouseReceiptPath: receiptPath,
				}),
			},
		})

		// One audit row per release
		await tx.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "PICKUP_RELEASE_SIGNED",
				diffJson: {
					release: number,
					warehouseId,
					releasedById,
					signedById: pickup.userId,
					crewSignerName: pickup.name,
					crewSignerBrigadeId: pickup.brigadeId,
					materialsTaken,
				},
			},
		})

		// Record overage audit and notifications if applicable
		if (hasOverage) {
			await tx.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "MATERIAL_OVERAGE",
					diffJson: {
						overages,
						estimatedMaterials,
						materialsTaken: totalTaken,
						threshold: 0,
					},
				},
			})

			for (const u of notifyUsers) {
				await tx.notification.create({
					data: {
						userId: u.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} was signed with material overage. Review the quantities.`,
					},
				})
			}
		}

		// Create RELEASE bulk movements for each material line
		for (const line of materialsTaken as {
			serviceCodeId: string
			qty: number
		}[]) {
			await tx.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RELEASE",
					warehouseId,
					serviceCodeId: line.serviceCodeId,
					qty: -Math.abs(line.qty),
					byUserId: user.id,
					refDocId: params.id,
				},
			})
		}
	})

	// Back to this page: another release, or Release complete.
	throw redirect(`/docs/${params.id}/sign`)
}

export default function SignDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		serviceCodes,
		warehouses,
		warehouseUsers,
		signerGroups,
		pickupErrorKey,
		user,
		releases,
		listed,
	} = loaderData
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const releaseRef = useRef<SignaturePadHandle>(null)
	const crewRef = useRef<SignaturePadHandle>(null)
	const [warehouseId, setWarehouseId] = useState(
		doc.warehouseId ?? (warehouses[0]?.id || ""),
	)
	const [releasedById, setReleasedById] = useState(
		user.role === "WAREHOUSE" ? user.id : "",
	)
	const signerOptions = signerGroups.flatMap((g) => g.signers)
	// One name on the job needs no choosing; several must be picked on purpose.
	const [crewSigner, setCrewSigner] = useState(
		signerOptions.length === 1 ? signerOptions[0].key : "",
	)
	// A signed release shows the list and the two next steps; the form is back
	// for "+ Add another release".
	const [adding, setAdding] = useState(false)
	const showForm = releases.length === 0 || adding
	const submit = useSubmit()
	const codeLabel = new Map(serviceCodes.map((c) => [c.id, c.claroCode]))
	const { t } = useTranslation()
	// Inline, not alert(): a modal OS dialog in the installed app, gone once dismissed.
	const [clientErrorKey, setClientErrorKey] = useState<ParseKeys | null>(null)
	const [releaseSigned, setReleaseSigned] = useState(false)
	const [crewSigned, setCrewSigned] = useState(false)
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when a release lands
	useEffect(() => {
		setAdding(false)
		setClientErrorKey(null)
		setReleaseSigned(false)
		setCrewSigned(false)
	}, [releases.length])
	const errorRef = useRef<HTMLDivElement>(null)
	const shownErrorKey =
		clientErrorKey ?? error?.errorKey ?? pickupErrorKey ?? undefined
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when an error appears or changes
	useEffect(() => {
		if (shownErrorKey)
			errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
	}, [shownErrorKey, error])

	function fail(key: ParseKeys) {
		setClientErrorKey(key)
	}

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		if (!warehouseId) {
			fail("docs_sign.alerts.select_warehouse")
			return
		}
		if (!releasedById) {
			fail("docs_sign.alerts.release_signer_required")
			return
		}
		if (signerGroups.length === 0) {
			fail("docs_sign.errors.no_pickup_signer")
			return
		}
		if (!crewSigner) {
			fail("docs_sign.alerts.crew_signer_required")
			return
		}
		if (releaseRef.current?.isEmpty()) {
			fail("docs_sign.alerts.release_signature_required")
			return
		}
		if (crewRef.current?.isEmpty()) {
			fail("docs_sign.alerts.crew_signature_required")
			return
		}
		setClientErrorKey(null)
		const formData = new FormData(e.currentTarget)
		const releasePad = releaseRef.current
		const crewPad = crewRef.current
		if (!releasePad || !crewPad) return
		formData.set("releaseSignature", releasePad.toDataURL())
		formData.set("crewSignature", crewPad.toDataURL())
		// "materials" comes from MaterialLineItems' own hidden input, so the
		// quantities the crew changed at the counter are the ones that get signed.
		formData.set("warehouseId", warehouseId)
		formData.set("releasedById", releasedById)
		formData.set("crewSigner", crewSigner)
		submit(formData, { method: "post" })
	}

	return (
		<div className="space-y-5">
			<div className="flex items-start justify-between gap-2">
				<div>
					<h1 className="text-xl font-semibold">{t("docs_sign.title")}</h1>
					<p className="text-sm font-mono text-muted-foreground">
						{doc.controlNumber}
					</p>
				</div>
				<Badge variant="info" className="shrink-0">
					{t("docs_sign.status_pill")}
				</Badge>
			</div>

			<JobStepRail docId={doc.id} current="RELEASE" role={user.role} />
			<Callout title={t("job_flow.callout.sign_title")}>
				{t("job_flow.callout.sign_body")}
			</Callout>

			{releases.length > 0 && (
				<section
					className="space-y-2 rounded-lg border p-3"
					data-testid="pickup-releases"
				>
					<h2 className="text-sm font-medium">
						{t("docs_sign.releases_title")}
					</h2>
					<ul className="divide-y text-sm">
						{releases.map((r) => (
							<li key={r.id} className="space-y-0.5 py-2">
								<p className="font-medium">
									{t("docs_sign.release_row", { n: r.number })}
								</p>
								<p className="text-muted-foreground">
									{t("docs_sign.release_row_people", {
										warehouse: r.releasedByName,
										crew: r.crewSignerName,
									})}
									{r.crewSignerBrigadeName
										? ` · ${r.crewSignerBrigadeName}${r.crewSignerBrigadeCode ? ` (${r.crewSignerBrigadeCode})` : ""}`
										: ""}
								</p>
								<p className="text-xs text-muted-foreground">
									{(r.materials as MaterialLine[])
										.map(
											(m) =>
												`${codeLabel.get(m.serviceCodeId) ?? m.serviceCodeId} × ${m.qty}`,
										)
										.join(" · ")}
								</p>
								<p
									className="text-xs text-muted-foreground"
									suppressHydrationWarning
								>
									{new Date(r.createdAt).toLocaleString()}
								</p>
							</li>
						))}
					</ul>
				</section>
			)}

			{!showForm && (
				<div className="space-y-2">
					{shownErrorKey && (
						<Callout tone="danger" title={t("docs_sign.error_title")}>
							{t(shownErrorKey)}
						</Callout>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="lg"
							onClick={() => setAdding(true)}
						>
							{t("docs_sign.add_release")}
						</Button>
						<Form method="post">
							<input type="hidden" name="intent" value="complete" />
							<Button type="submit" size="lg">
								{t("docs_sign.release_complete")}
							</Button>
						</Form>
					</div>
				</div>
			)}

			{showForm && (
				<Form
					key={releases.length}
					method="post"
					onSubmit={handleSubmit}
					className="space-y-5"
				>
					<div>
						<Label>{t("docs_sign.warehouse_label")}</Label>
						<Select
							items={warehouses.map((w) => ({ value: w.id, label: w.name }))}
							value={warehouseId}
							onValueChange={(v) => setWarehouseId(v ?? "")}
						>
							<SelectTrigger className="mt-1 h-11 w-full text-base">
								<SelectValue
									placeholder={t("docs_sign.warehouse_placeholder")}
								/>
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
								serviceCodes={serviceCodes}
								initialItems={listed}
								estimatedItems={listed}
								readOnly={false}
								name="materials"
								touch
							/>
						</div>
						<p className="mt-2 text-xs text-muted-foreground">
							{t("docs_sign.more_is_normal")}
						</p>
					</div>

					<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
						<div className="border rounded-lg p-3 space-y-3">
							<div>
								<p className="text-sm font-medium mb-1">
									{t("docs_sign.release_signature_heading")}
								</p>
								<p className="text-xs text-muted-foreground mb-2">
									{t("docs_sign.release_signature_subtext")}
								</p>
								<Label className="text-xs text-muted-foreground">
									{t("docs_sign.release_signer_label")}
								</Label>
								<Select
									items={warehouseUsers.map((u) => ({
										value: u.id,
										label: u.name,
									}))}
									value={releasedById}
									onValueChange={(v) => setReleasedById(v ?? "")}
								>
									<SelectTrigger className="mt-1 h-11 w-full text-base">
										<SelectValue
											placeholder={t("docs_sign.release_signer_placeholder")}
										/>
									</SelectTrigger>
									<SelectContent>
										{warehouseUsers.map((u) => (
											<SelectItem key={u.id} value={u.id}>
												{u.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<SignaturePad
								ref={releaseRef}
								height={140}
								onChange={(empty) => setReleaseSigned(!empty)}
							/>
							<p className="text-xs text-muted-foreground">
								{releaseSigned
									? t("docs_sign.signed")
									: t("docs_sign.sig_prompt")}
							</p>
							<Button
								type="button"
								variant="ghost"
								size="lg"
								className="h-11 text-base"
								onClick={() => releaseRef.current?.clear()}
							>
								{t("docs_sign.clear")}
							</Button>
						</div>

						<div className="border rounded-lg p-3 space-y-3">
							<div>
								<p className="text-sm font-medium mb-1">
									{t("docs_sign.crew_signature_heading")}
								</p>
								<p className="text-xs text-muted-foreground mb-2">
									{t("docs_sign.crew_signature_subtext")}
								</p>
								<Label className="text-xs text-muted-foreground">
									{t("docs_sign.crew_signer_label")}
								</Label>
								<CrewSignerSelect
									groups={signerGroups}
									value={crewSigner}
									onChange={setCrewSigner}
								/>
							</div>
							<SignaturePad
								ref={crewRef}
								height={140}
								onChange={(empty) => setCrewSigned(!empty)}
							/>
							<p className="text-xs text-muted-foreground">
								{crewSigned ? t("docs_sign.signed") : t("docs_sign.sig_prompt")}
							</p>
							<Button
								type="button"
								variant="ghost"
								size="lg"
								className="h-11 text-base"
								onClick={() => crewRef.current?.clear()}
							>
								{t("docs_sign.clear")}
							</Button>
						</div>
					</div>

					<Callout
						tone="info"
						icon={<span aria-hidden="true">🔒</span>}
						title={t("docs_sign.lock_banner_title")}
					>
						{t("docs_sign.lock_banner_body")}
					</Callout>

					{shownErrorKey && (
						<div ref={errorRef} role="alert">
							<Callout tone="danger" title={t("docs_sign.error_title")}>
								{t(shownErrorKey)}
							</Callout>
						</div>
					)}

					<Button type="submit" size="lg" className="h-12 w-full text-base">
						{t("docs_sign.submit")}
					</Button>
				</Form>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
