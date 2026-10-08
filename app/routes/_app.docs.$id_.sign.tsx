import fs from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { JobStepRail } from "~/components/job-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
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
import { isUnassignedCrew, notAssignedResponse } from "~/lib/crew-scope"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	getActiveServiceCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.sign"

type MaterialLine = { serviceCodeId: string; qty: number }

export const meta: Route.MetaFunction = ({ data, matches }) => [
	{
		title: data
			? pageTitle(matches, "page_title.sign", data.doc.controlNumber)
			: pageTitle(matches),
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["CREW", "WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (isUnassignedCrew(user, doc)) throw notAssignedResponse()
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await getActiveMaterialCodes()
	const warehouses = await db.warehouse.findMany({ where: { active: true } })
	const warehouseUsers = await db.user.findMany({
		where: { role: "WAREHOUSE", active: true },
		orderBy: { name: "asc" },
	})
	const crewUsers = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
	})
	return {
		doc,
		user,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		warehouses,
		warehouseUsers,
		crewUsers,
	}
}

function buildOverages(
	materialsTaken: MaterialLine[],
	estimatedMaterials: MaterialLine[],
): { serviceCodeId: string; estimatedQty: number; takenQty: number }[] {
	const estimatedMap = Object.fromEntries(
		estimatedMaterials.map((e) => [e.serviceCodeId, e.qty]),
	)
	const overages: {
		serviceCodeId: string
		estimatedQty: number
		takenQty: number
	}[] = []
	for (const taken of materialsTaken) {
		const estimatedQty = estimatedMap[taken.serviceCodeId] ?? 0
		if (taken.qty > estimatedQty) {
			overages.push({
				serviceCodeId: taken.serviceCodeId,
				estimatedQty,
				takenQty: taken.qty,
			})
		}
	}
	return overages
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["CREW", "WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (isUnassignedCrew(user, doc)) throw notAssignedResponse()
	if (!canTransition(doc.status, "SIGNED", user.role))
		throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	const releaseSignature = form.get("releaseSignature") as string
	const crewSignature = form.get("crewSignature") as string
	const warehouseId = form.get("warehouseId") as string
	const releasedById = form.get("releasedById") as string
	const signedById = form.get("signedById") as string
	const materialsRaw = form.get("materials") as string

	if (!warehouseId) {
		return { errorKey: "docs_sign.errors.warehouse_required" }
	}
	if (!releasedById) {
		return { errorKey: "docs_sign.errors.release_signer_required" }
	}
	if (!signedById) {
		return { errorKey: "docs_sign.errors.crew_signer_required" }
	}
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
	const [releaseSigner, crewSigner, warehouse] = await Promise.all([
		db.user.findFirst({
			where: { id: releasedById, role: "WAREHOUSE", active: true },
		}),
		db.user.findFirst({
			where: { id: signedById, role: "CREW", active: true },
		}),
		db.warehouse.findUnique({ where: { id: warehouseId } }),
	])
	if (!releaseSigner) {
		return { errorKey: "docs_sign.errors.release_signer_invalid" }
	}
	if (!crewSigner) {
		return { errorKey: "docs_sign.errors.crew_signer_invalid" }
	}

	// Permanently lock: refuse to overwrite an existing signed materials record.
	const existingTaken = (doc.materialsTaken as MaterialLine[] | null) ?? []
	if (existingTaken.length > 0) {
		return { errorKey: "docs_sign.errors.already_signed" }
	}

	const serviceCodes = await getActiveServiceCodes()
	const pdfBytes = await generateWarehouseReceiptPdf(
		{
			...doc,
			materialsTaken,
			releaseSignature,
			crewSignature,
			releaseSignerName: releaseSigner.name,
			crewSignerName: crewSigner.name,
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
	const receiptPath = path.join(receiptDir, `${params.id}-receipt.pdf`)
	await fs.writeFile(receiptPath, pdfBytes)

	const estimatedMaterials =
		(doc.estimatedMaterials as MaterialLine[] | null) ?? []
	const overages = buildOverages(materialsTaken, estimatedMaterials)
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
		// Update invoice to SIGNED status
		await tx.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "SIGNED",
				warehouseId,
				materialsTaken,
				releaseSignature,
				releasedById,
				releaseSignedAt: new Date(),
				crewSignature,
				signedById,
				signedAt: new Date(),
				warehouseReceiptPath: receiptPath,
			},
		})

		// Record status change audit
		await tx.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: {
					status: { before: doc.status, after: "SIGNED" },
					warehouseId,
					releasedById,
					signedById,
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
						materialsTaken,
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

	throw redirect(`/docs/${params.id}`)
}

export default function SignDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, warehouses, warehouseUsers, crewUsers, user } =
		loaderData
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const releaseRef = useRef<SignaturePadHandle>(null)
	const crewRef = useRef<SignaturePadHandle>(null)
	const [warehouseId, setWarehouseId] = useState(
		doc.warehouseId ?? (warehouses[0]?.id || ""),
	)
	const [releasedById, setReleasedById] = useState(
		user.role === "WAREHOUSE" ? user.id : "",
	)
	const [signedById, setSignedById] = useState(
		user.role === "CREW" ? user.id : "",
	)
	const [items, setItems] = useState(
		(doc.estimatedMaterials as MaterialLine[] | null) ?? [],
	)
	// What the job listed; fixed, so the counter can see how far "taken" drifts.
	const [listed] = useState(
		(doc.estimatedMaterials as MaterialLine[] | null) ?? [],
	)
	const submit = useSubmit()
	const { t } = useTranslation()

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		if (!warehouseId) {
			alert(t("docs_sign.alerts.select_warehouse"))
			return
		}
		if (!releasedById) {
			alert(t("docs_sign.alerts.release_signer_required"))
			return
		}
		if (!signedById) {
			alert(t("docs_sign.alerts.crew_signer_required"))
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
		const releasePad = releaseRef.current
		const crewPad = crewRef.current
		if (!releasePad || !crewPad) return
		formData.set("releaseSignature", releasePad.toDataURL())
		formData.set("crewSignature", crewPad.toDataURL())
		formData.set("materials", JSON.stringify(items))
		formData.set("warehouseId", warehouseId)
		formData.set("releasedById", releasedById)
		formData.set("signedById", signedById)
		submit(formData, { method: "post" })
	}

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_sign.title")}</h1>
			<p className="text-sm font-mono text-muted-foreground">
				{doc.controlNumber}
			</p>

			<JobStepRail docId={doc.id} current="RELEASE" role={user.role} />
			<Callout
				title={t(
					user.role === "CREW"
						? "job_flow.callout.sign_title_crew"
						: "job_flow.callout.sign_title",
				)}
			>
				{t("job_flow.callout.sign_body")}
			</Callout>

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
							serviceCodes={serviceCodes}
							initialItems={items}
							estimatedItems={listed}
							onChange={setItems}
							readOnly={false}
							name="materials"
						/>
					</div>
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
								value={releasedById}
								onValueChange={(v) => setReleasedById(v ?? "")}
							>
								<SelectTrigger className="mt-1">
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
						<SignaturePad ref={releaseRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => releaseRef.current?.clear()}
							className="text-xs text-muted-foreground mt-1 hover:text-foreground"
						>
							{t("docs_sign.clear")}
						</button>
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
							<Select
								value={signedById}
								onValueChange={(v) => setSignedById(v ?? "")}
							>
								<SelectTrigger className="mt-1">
									<SelectValue
										placeholder={t("docs_sign.crew_signer_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{crewUsers.map((u) => (
										<SelectItem key={u.id} value={u.id}>
											{u.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<SignaturePad ref={crewRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => crewRef.current?.clear()}
							className="text-xs text-muted-foreground mt-1 hover:text-foreground"
						>
							{t("docs_sign.clear")}
						</button>
					</div>
				</div>

				<Callout
					tone="info"
					icon={<span aria-hidden="true">🔒</span>}
					title={t("docs_sign.lock_banner_title")}
				>
					{t("docs_sign.lock_banner_body")}
				</Callout>

				{error?.errorKey && (
					<p className="text-sm text-status-danger">{t(error.errorKey)}</p>
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
