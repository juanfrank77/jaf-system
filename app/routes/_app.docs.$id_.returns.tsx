import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ReturnsForm } from "~/components/returns-form"
import { db } from "~/lib/db.server"
import { warehouseUsedLines } from "~/lib/field-materials"
import { runOnce } from "~/lib/idempotency.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { dispositionSerial } from "~/lib/repair.server"
import {
	computeExpectedBackLines,
	type MaterialLine,
} from "~/lib/returns-lines"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.returns"

type SerialReturnReason = "DAMAGED" | "LOST" | "MISCOUNT" | "UNDER_REPORTED"

export const meta = ({
	data,
	matches,
}: {
	data?: { doc: { controlNumber: string } }
	matches: Parameters<typeof pageTitle>[0]
}) => [
	{
		title: data
			? pageTitle(matches, "page_title.returns", data.doc.controlNumber)
			: pageTitle(matches),
	},
]

/** The shape this route writes into `JafInvoice.materialsReturned`. */
type ReturnedLine = {
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes: string
}

/** Already-saved returns for this doc, or `[]` when nothing is recorded yet. */
function savedReturnsOf(doc: { materialsReturned: unknown }): ReturnedLine[] {
	const raw = doc.materialsReturned
	if (!Array.isArray(raw)) return []
	return raw.filter(
		(r): r is ReturnedLine =>
			typeof r === "object" && r !== null && "serviceCodeId" in r,
	)
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	// A no-warehouse job never took material out: nothing comes back.
	if (
		!["SIGNED", "FIELD_UPDATED"].includes(doc.status) ||
		!doc.materialsFromWarehouse
	)
		throw redirect(`/docs/${params.id}`)
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	// A taken line whose material has since been deactivated must still resolve
	// to a name — the form would otherwise render the raw database id.
	const [activeCodes, takenCodes, warehouses] = await Promise.all([
		getActiveMaterialCodes(),
		db.serviceCode.findMany({
			where: { id: { in: taken.map((l) => l.serviceCodeId) } },
		}),
		db.warehouse.findMany({
			where: { active: true },
			orderBy: { name: "asc" },
		}),
	])
	const known = new Set(activeCodes.map((c) => c.id))
	const serviceCodes = [
		...activeCodes,
		...takenCodes.filter((c) => !known.has(c.id)),
	]
	// Only what came out of the warehouse's stock is owed back: the brigade's
	// own stock (in the Field table) never left the warehouse.
	const materialsUsed = warehouseUsedLines(
		doc.fieldMaterials,
		doc.materialsUsed,
	)
	const lines = computeExpectedBackLines(taken, materialsUsed)
	// Revisiting the page after a save must show what was actually SAVED, not a
	// blank/full-expected form — otherwise a second "Save Returns" click posts a
	// complete second credit under a fresh idempotency key (double-credit). The
	// action refuses a repeat confirm too (defence in depth).
	const savedReturns = savedReturnsOf(doc)
	return {
		doc,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		taken,
		lines,
		materialsUsed,
		warehouses,
		pickupWarehouseId: doc.warehouseId,
		savedReturns,
		alreadyRecorded: savedReturns.length > 0,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (
		!["SIGNED", "FIELD_UPDATED"].includes(doc.status) ||
		!doc.materialsFromWarehouse
	) {
		throw redirect(`/docs/${params.id}`)
	}

	// Once returns are recorded for a doc they are final: there is no amend flow
	// in the spec (§6/§7 describe a single returns-confirm), so a repeat confirm
	// — a second click, a back-button resubmit, an offline replay under a FRESH
	// idempotency key — must not post a second set of RETURN credits. The
	// loader's prefill + the post-save redirect make this the normal path; this
	// is the server-side guarantee behind them.
	// (`materialsReturned` is empty for a serial-only return, so also look for
	// the RETURNS_LOGGED audit row this action always writes.)
	const alreadyLogged =
		savedReturnsOf(doc).length > 0 ||
		(await db.auditTrail.findFirst({
			where: { docId: params.id, action: "RETURNS_LOGGED" },
			select: { id: true },
		})) !== null
	if (alreadyLogged) {
		return { errorKey: "docs_returns.errors.already_recorded" as const }
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
	const returnNote = String(form.get("returnNote") ?? "").trim()

	if (!returnWarehouseId) {
		return { errorKey: "docs_returns.errors.warehouse_required" as const }
	}
	if (!idempotencyKey) {
		return { errorKey: "docs_returns.errors.idempotency_key_required" as const }
	}
	// The loader only offers ACTIVE warehouses, but the action must not trust
	// the client: a fabricated id would credit a non-existent (or retired)
	// warehouse's ledger. Cross-warehouse returns stay permissive (spec §9) —
	// this only proves the target is real and active.
	const returnWarehouse = await db.warehouse.findFirst({
		where: { id: returnWarehouseId, active: true },
		select: { id: true },
	})
	if (!returnWarehouse) {
		return { errorKey: "docs_returns.errors.invalid_warehouse" as const }
	}

	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const materialsUsed = warehouseUsedLines(
		doc.fieldMaterials,
		doc.materialsUsed,
	)

	for (const line of lines) {
		if (!line.serviceCodeId) {
			return { errorKey: "docs_returns.errors.invalid_materials" as const }
		}
		// A negative (or fractional) `received` used to be silently `Math.abs`'d
		// into a positive ledger credit while the doc kept the raw value — the
		// ledger and the doc's own record would disagree. Reject it instead.
		if (!Number.isInteger(line.received) || line.received < 0) {
			return {
				errorKey: "docs_returns.errors.invalid_received_qty" as const,
				errorParams: { serviceCodeId: line.serviceCodeId },
			}
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

	// Recorded against the AUTHORITATIVE expected-back set recomputed from the
	// doc (taken − used). Coming back short is normal (crews need not return
	// leftovers right away), so it is recorded, never warned about.
	const receivedMap = new Map<string, number>()
	for (const l of lines) receivedMap.set(l.serviceCodeId, l.received)
	const expectedLines = computeExpectedBackLines(taken, materialsUsed)
	// A LOST or DAMAGED serialized unit is real shrinkage (spec §7) — a
	// reasonable auditor expects a recorded reason, so it requires a note.
	const anySerialLoss = serialLines.some(
		(s) => s.reason === "LOST" || s.reason === "DAMAGED",
	)
	if (anySerialLoss && !returnNote) {
		return { errorKey: "returns.note_required" as const }
	}

	await runOnce(db, idempotencyKey, "returns", async (tx) => {
		for (const l of lines) {
			if (!l.received) continue // nothing to credit
			await tx.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RETURN",
					warehouseId: returnWarehouseId,
					serviceCodeId: l.serviceCodeId,
					// Validated non-negative above — no Math.abs coercion, so the
					// ledger credit and the doc's `returnedQty` can never disagree.
					qty: l.received,
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
				//
				// The warehouse a PHYSICAL unit's disposition is recorded under is
				// the one the unit is actually in — `SerialLocation.currentRef`, set
				// by scan-in to wherever it was physically scanned back. That is a
				// different thing from `returnWarehouseId`, which is only the
				// counter's chosen destination for the BULK credit and is allowed to
				// differ (spec §9 permits a cross-warehouse return). Passing the
				// credit target here tripped dispositionSerial's ownership check and
				// 500'd every legitimate cross-warehouse damaged-serial return.
				const owner = await tx.serialLocation.findUnique({
					where: { serial: s.serial },
					select: { currentRef: true },
				})
				await dispositionSerial(
					{
						serial: s.serial,
						disposition: "FAILED",
						byUserId: user.id,
						// No row / no currentRef → let dispositionSerial raise its own
						// clear error rather than silently inventing a warehouse.
						warehouseId: owner?.currentRef ?? returnWarehouseId,
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
						note: `LOST${returnNote ? `: ${returnNote}` : ""}`,
					},
				})
			}
			// MISCOUNT / UNDER_REPORTED: recorded below (materialsReturned +
			// audit trail) only — no serial state change.
		}

		// Recorded from the AUTHORITATIVE expected-back set (plus any extra line
		// the counter added), so an omitted line is stored as returnedQty 0
		// rather than vanishing from the doc's own record.
		const extraLines = lines.filter(
			(l) => !expectedLines.some((e) => e.serviceCodeId === l.serviceCodeId),
		)
		const materialsReturned = [
			...expectedLines.map((e) => ({
				serviceCodeId: e.serviceCodeId,
				takenQty: e.takenQty,
				returnedQty: receivedMap.get(e.serviceCodeId) ?? 0,
				notes: "",
			})),
			...extraLines.map((l) => ({
				serviceCodeId: l.serviceCodeId,
				takenQty: takenMap[l.serviceCodeId] ?? 0,
				returnedQty: l.received,
				notes: "",
			})),
		]

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
					returnNote: returnNote || null,
				} as unknown as Prisma.InputJsonValue,
			},
		})
	})

	// Post-save redirect (pre-branch behaviour, restored): a successful confirm
	// leaves the form behind entirely, so there is no second-click resubmit of
	// the same payload under a fresh idempotency key. `out.deduped` means a
	// replayed key wrote nothing — same destination either way.
	throw redirect(`/docs/${params.id}`)
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
