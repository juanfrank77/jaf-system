import fs from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
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
import { BackLink } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.sign"

type MaterialLine = { serviceCodeId: string; qty: number }

type PreppedMaterialLine = {
	serviceCodeId: string
	preppedQty?: number
	estimatedQty?: number
}

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
	// Use all active service codes instead of just materials
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
		orderBy: { claroCode: "asc" },
	})
	const warehouses = await db.warehouse.findMany({
		where: { active: true },
		orderBy: { name: "asc" },
	})
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
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
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

	// Auto-assign crew member if not already assigned
	const assignedCrewIds = doc.assignedCrewIds ?? []
	const isCrewAssigned = assignedCrewIds.includes(signedById)
	const updatedCrewIds = isCrewAssigned
		? assignedCrewIds
		: [...assignedCrewIds, signedById]

	// Track crew assignment history if auto-assigning
	type CrewAssignmentEntry = {
		userIds: string[]
		assignedById: string
		assignedAt: string
	}
	const crewAssignmentHistory = !isCrewAssigned
		? [
				...((doc.crewAssignmentHistory as CrewAssignmentEntry[]) || []),
				{
					userIds: [signedById],
					assignedById: releasedById, // warehouse person assigned them
					assignedAt: new Date().toISOString(),
				},
			]
		: (doc.crewAssignmentHistory as CrewAssignmentEntry[]) || []

	// Permanently lock: refuse to overwrite an existing signed materials record.
	const existingTaken = (doc.materialsTaken as MaterialLine[] | null) ?? []
	if (existingTaken.length > 0) {
		return { errorKey: "docs_sign.errors.already_signed" }
	}

	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
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

	const statusChangeAudit = db.auditTrail.create({
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
				crewAutoAssigned: !isCrewAssigned ? signedById : null,
			},
		},
	})

	const updateInvoice = db.jafInvoice.update({
		where: { id: params.id },
		data: {
			status: "SIGNED",
			warehouseId,
			assignedCrewIds: updatedCrewIds,
			crewAssignmentHistory:
				crewAssignmentHistory as unknown as Prisma.InputJsonValue,
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

	const ops: Prisma.PrismaPromise<unknown>[] = [
		updateInvoice,
		statusChangeAudit,
	]

	// Notify crew member if they were auto-assigned during pickup
	if (!isCrewAssigned) {
		ops.push(
			db.notification.create({
				data: {
					userId: signedById,
					docId: params.id,
					message: `You have been assigned to job ${doc.controlNumber} (signed at pickup).`,
				},
			}),
		)
	}

	if (hasOverage) {
		ops.push(
			db.auditTrail.create({
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
			}),
		)

		const notifyUsers = await db.user.findMany({
			where: {
				active: true,
				OR: [{ id: doc.supervisorId }, { role: "ADMIN" }],
			},
			select: { id: true },
		})
		ops.push(
			...notifyUsers.map((u) =>
				db.notification.create({
					data: {
						userId: u.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} was signed with material overage. Review the quantities.`,
					},
				}),
			),
		)
	}

	await db.$transaction(ops)

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

	// Use preppedMaterials if available (from warehouse prep), otherwise fall back to estimatedMaterials
	const preppedMaterials =
		(doc.preppedMaterials as PreppedMaterialLine[] | null) ?? []
	const estimatedMaterials =
		(doc.estimatedMaterials as MaterialLine[] | null) ?? []
	const initialMaterials =
		preppedMaterials.length > 0
			? preppedMaterials.map((p) => ({
					serviceCodeId: p.serviceCodeId,
					qty: p.preppedQty ?? p.estimatedQty ?? 1,
				}))
			: estimatedMaterials

	const [items] = useState(initialMaterials)
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

	const page = (
		<div className="space-y-5">
			<BackLink to={`/docs/${doc.id}`}>
				{t("docs_view.back_to_work_order")}
			</BackLink>
			<h1 className="text-xl font-semibold">{t("docs_sign.title")}</h1>
			<p className="text-sm font-mono text-slate-500">{doc.controlNumber}</p>

			<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
				{t("docs_sign.review_notice")}
			</div>

			<Form method="post" onSubmit={handleSubmit} className="space-y-5">
				<div>
					<Label>{t("docs_sign.warehouse_label")}</Label>
					<select
						value={warehouseId}
						onChange={(e) => setWarehouseId(e.target.value)}
						className="mt-1 w-full rounded-md border border-input bg-input/30 px-3 py-2 text-sm h-9"
						required
					>
						<option value="">{t("docs_sign.warehouse_placeholder")}</option>
						{warehouses.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name} — {w.zone}
							</option>
						))}
					</select>
				</div>

				<div>
					<Label>{t("docs_sign.materials_taken_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems
							serviceCodes={serviceCodes}
							initialItems={items}
							readOnly={true}
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
							<p className="text-xs text-slate-500 mb-2">
								{t("docs_sign.release_signature_subtext")}
							</p>
							<Label className="text-xs text-slate-500">
								{t("docs_sign.release_signer_label")}
							</Label>
							<select
								value={releasedById}
								onChange={(e) => setReleasedById(e.target.value)}
								className="mt-1 w-full rounded-md border border-input bg-input/30 px-3 py-2 text-sm h-9"
								required
							>
								<option value="">
									{t("docs_sign.release_signer_placeholder")}
								</option>
								{warehouseUsers.map((u) => (
									<option key={u.id} value={u.id}>
										{u.name}
									</option>
								))}
							</select>
						</div>
						<SignaturePad ref={releaseRef} width={320} height={120} />
						<button
							type="button"
							onClick={() => releaseRef.current?.clear()}
							className="text-xs text-slate-400 mt-1 hover:text-slate-600"
						>
							{t("docs_sign.clear")}
						</button>
					</div>

					<div className="border rounded-lg p-3 space-y-3">
						<div>
							<p className="text-sm font-medium mb-1">
								{t("docs_sign.crew_signature_heading")}
							</p>
							<p className="text-xs text-slate-500 mb-2">
								{t("docs_sign.crew_signature_subtext")}
							</p>
							<Label className="text-xs text-slate-500">
								{t("docs_sign.crew_signer_label")}
							</Label>
							<select
								value={signedById}
								onChange={(e) => setSignedById(e.target.value)}
								className="mt-1 w-full rounded-md border border-input bg-input/30 px-3 py-2 text-sm h-9"
								required
							>
								<option value="">
									{t("docs_sign.crew_signer_placeholder")}
								</option>
								{crewUsers.map((u) => (
									<option key={u.id} value={u.id}>
										{u.name}
									</option>
								))}
							</select>
						</div>
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

				{error?.errorKey && (
					<p className="text-sm text-red-600">{t(error.errorKey)}</p>
				)}

				<Button type="submit" className="w-full">
					{t("docs_sign.submit")}
				</Button>
			</Form>
		</div>
	)

	return page
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
