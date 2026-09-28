import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ReturnsForm } from "~/components/returns-form"
import { db } from "~/lib/db.server"
import { runOnce } from "~/lib/idempotency.server"
import { requireRole } from "~/lib/permissions.server"
import { dispositionSerial } from "~/lib/repair.server"
import {
	computeExpectedBackLines,
	expectedBackFor,
	type MaterialLine,
} from "~/lib/returns-lines"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.returns"

type SerialReturnReason = "DAMAGED" | "LOST" | "MISCOUNT" | "UNDER_REPORTED"

export const meta = ({
	data,
}: {
	data?: { doc: { controlNumber: string } }
}) => [
	{
		title: data
			? `${data.doc.controlNumber} — Log Returns — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!["SIGNED", "FIELD_UPDATED"].includes(doc.status))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await getActiveMaterialCodes()
	const warehouses = await db.warehouse.findMany({ where: { active: true } })
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const materialsUsed =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[] | null) ||
		null
	const lines = computeExpectedBackLines(taken, materialsUsed)
	return {
		doc,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		taken,
		lines,
		materialsUsed,
		warehouses,
		pickupWarehouseId: doc.warehouseId,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!["SIGNED", "FIELD_UPDATED"].includes(doc.status)) {
		throw redirect(`/docs/${params.id}`)
	}

	const form = await request.formData()
	// Signed quantities are immutable after pickup — this route never accepts
	// a client-supplied materialsTaken.
	form.delete("materialsTaken")

	let lines: { serviceCodeId: string; received: number }[] = []
	let serialLines: { serial: string; reason: SerialReturnReason | string }[] =
		[]
	try {
		lines = JSON.parse(String(form.get("lines") ?? "[]"))
		serialLines = JSON.parse(String(form.get("serialLines") ?? "[]"))
	} catch {
		return { errorKey: "docs_returns.errors.invalid_materials" as const }
	}

	const returnWarehouseId = String(form.get("returnWarehouseId") ?? "").trim()
	const idempotencyKey = String(form.get("idempotencyKey") ?? "").trim()
	const discrepancyNote = String(form.get("discrepancyNote") ?? "").trim()

	if (!returnWarehouseId) {
		return { errorKey: "docs_returns.errors.warehouse_required" as const }
	}
	if (!idempotencyKey) {
		return { errorKey: "docs_returns.errors.idempotency_key_required" as const }
	}

	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const materialsUsed =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[] | null) || []
	const usedMap = Object.fromEntries(
		materialsUsed.map((u) => [u.serviceCodeId, u.qty]),
	)

	for (const line of lines) {
		if (!line.serviceCodeId) {
			return { errorKey: "docs_returns.errors.invalid_materials" as const }
		}
		const takenQty = takenMap[line.serviceCodeId] ?? 0
		if (line.received > takenQty) {
			return {
				errorKey: "docs_returns.errors.return_exceeds_taken" as const,
				errorParams: { serviceCodeId: line.serviceCodeId },
			}
		}
	}

	const uniqueServiceCodeIds = Array.from(
		new Set(lines.map((l) => l.serviceCodeId).filter(Boolean)),
	)
	if (uniqueServiceCodeIds.length > 0) {
		const validServiceCodes = await db.serviceCode.findMany({
			where: { id: { in: uniqueServiceCodeIds }, active: true },
			select: { id: true },
		})
		const validServiceCodeSet = new Set(validServiceCodes.map((c) => c.id))
		const invalidServiceCodes = uniqueServiceCodeIds.filter(
			(id) => !validServiceCodeSet.has(id),
		)
		if (invalidServiceCodes.length > 0) {
			return { errorKey: "docs_returns.errors.invalid_service_codes" as const }
		}
	}

	const anyShort = lines.some(
		(l) =>
			l.received <
			expectedBackFor(
				takenMap[l.serviceCodeId] ?? 0,
				usedMap[l.serviceCodeId] ?? 0,
			),
	)
	if (anyShort && !discrepancyNote) {
		return { errorKey: "returns.note_required" as const }
	}

	const out = await runOnce(db, idempotencyKey, "returns", async (tx) => {
		for (const l of lines) {
			if (!l.received) continue // nothing to credit
			await tx.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RETURN",
					warehouseId: returnWarehouseId,
					serviceCodeId: l.serviceCodeId,
					qty: Math.abs(l.received),
					byUserId: user.id,
					refDocId: params.id,
				},
			})
		}

		for (const s of serialLines) {
			if (s.reason === "DAMAGED") {
				// Composes atomically with the bulk RETURN writes above — the CAS
				// guard inside requires the serial already be RETURNED (set by the
				// existing scan-in flow before this action ever runs).
				await dispositionSerial(
					{
						serial: s.serial,
						disposition: "FAILED",
						byUserId: user.id,
						warehouseId: returnWarehouseId,
					},
					tx,
				)
			} else if (s.reason === "LOST") {
				const moved = await tx.serialLocation.updateMany({
					where: { serial: s.serial, status: "RETURNED" },
					data: {
						status: "LOST",
						currentRef: returnWarehouseId,
						since: new Date(),
					},
				})
				if (moved.count !== 1)
					throw new Error(`serial ${s.serial}: expected status RETURNED`)
				const sl = await tx.serialLocation.findUniqueOrThrow({
					where: { serial: s.serial },
					select: { serviceCodeId: true },
				})
				await tx.stockMovement.create({
					data: {
						kind: "SERIAL",
						type: "DISPOSITION",
						serial: s.serial,
						qty: 0,
						serviceCodeId: sl.serviceCodeId,
						warehouseId: returnWarehouseId,
						byUserId: user.id,
						refDocId: params.id,
						note: `LOST${discrepancyNote ? `: ${discrepancyNote}` : ""}`,
					},
				})
			}
			// MISCOUNT / UNDER_REPORTED: recorded below (materialsReturned +
			// audit trail) only — no serial state change.
		}

		const materialsReturned = lines.map((l) => ({
			serviceCodeId: l.serviceCodeId,
			takenQty: takenMap[l.serviceCodeId] ?? 0,
			returnedQty: l.received,
			notes: "",
		}))

		await tx.jafInvoice.update({
			where: { id: params.id },
			data: {
				materialsReturned:
					materialsReturned as unknown as Prisma.InputJsonValue,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "RETURNS_LOGGED",
				diffJson: {
					returnWarehouseId,
					lines,
					serialLines,
					discrepancyNote: discrepancyNote || null,
				} as unknown as Prisma.InputJsonValue,
			},
		})
	})

	return { ok: true as const, deduped: out.deduped }
}

export default function ReturnsDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return <ReturnsForm loaderData={loaderData} actionData={actionData} />
}

export function ErrorBoundary({ error }: { error: unknown }) {
	return <RouteErrorBoundary error={error} />
}
