import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import {
	correctTriage,
	createRepairBatch,
	generateRepairBatchDocument,
	receiveRepairedUnits,
	voidRepairBatch,
} from "~/lib/repair.server"
import { serializedOnHand } from "~/lib/serial-stock"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.repairs"

export const meta: Route.MetaFunction = () => [{ title: "Repairs — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	// Honors the header warehouse switch (`wh` cookie) like every Spec B
	// screen; ADMIN resolves to all active warehouses rather than throwing.
	const { selectedId } = await resolveWarehouseScope(db, request, user)
	// A user with no warehouse at all (e.g. an ADMIN before any warehouse
	// exists) gets empty queues, never the bare-Error 500 the old helper threw.
	const warehouseId = selectedId ?? "__no_warehouse__"
	const [pool, batches, onHand, intakes] = await Promise.all([
		db.serialLocation.findMany({
			where: { status: "AWAITING_REPAIR", currentRef: warehouseId },
			select: { serial: true, serviceCodeId: true },
			orderBy: { since: "asc" },
		}),
		db.repairBatch.findMany({
			where: { warehouseId },
			orderBy: { sentAt: "desc" },
			take: 20,
		}),
		serializedOnHand(warehouseId),
		db.repairIntake.findMany({
			where: { warehouseId },
			orderBy: { receivedAt: "desc" },
			take: 10,
		}),
	])
	return { pool, batches, onHand, intakes }
}

/**
 * One flat result shape for every branch, so the UI can read `batchId` /
 * `flagged` / `errorKey` without a discriminated-union dance.
 */
type RepairsActionResult = {
	ok?: boolean
	batchId?: string
	docFailed?: boolean
	intakeId?: string
	flagged?: string[]
	errorKey?: "stock.no_warehouse" | "repairs.action_failed"
	errorDetail?: string | null
}

export async function action({
	request,
}: Route.ActionArgs): Promise<RepairsActionResult> {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId: warehouseId } = await resolveWarehouseScope(
		db,
		request,
		user,
	)
	if (!warehouseId) {
		return { errorKey: "stock.no_warehouse" as const, errorDetail: null }
	}
	const form = await request.formData()
	const intent = String(form.get("intent"))

	// The repair services throw plain Errors for every domain rejection (CAS
	// drift naming the serial, void-blocked, missing reason, cross-warehouse).
	// Nothing caught them, so they reached the error boundary as raw 500s — the
	// spec wants "blocked with a clear message" / "a structured error naming the
	// drifted serial". Translate them into the route's errorKey convention and
	// carry the service's own message as the detail.
	try {
		return await runIntent({ request, form, intent, warehouseId, user })
	} catch (e) {
		if (e instanceof Response) throw e // redirects from requireWarehouseLead
		if (e instanceof Error) {
			return {
				errorKey: "repairs.action_failed" as const,
				errorDetail: e.message,
			}
		}
		throw e
	}
}

async function runIntent({
	request,
	form,
	intent,
	warehouseId,
	user,
}: {
	request: Request
	form: FormData
	intent: string
	warehouseId: string
	user: { id: string }
}): Promise<RepairsActionResult> {
	switch (intent) {
		case "create_batch": {
			await requireWarehouseLead(request, warehouseId)
			const serials = form.getAll("serial").map(String).filter(Boolean)
			const claroReference = form.get("claroReference")
				? String(form.get("claroReference"))
				: undefined
			const { batchId } = await createRepairBatch({
				serials,
				warehouseId,
				byUserId: user.id,
				claroReference,
			})
			// PDF gen is non-blocking (spec §9): a render/write failure must not
			// fail the committed batch — the Regenerate action recovers it.
			let docFailed = false
			try {
				await generateRepairBatchDocument(batchId)
			} catch {
				docFailed = true
			}
			return { ok: true, batchId, docFailed }
		}
		case "void_batch": {
			await requireWarehouseLead(request, warehouseId)
			await voidRepairBatch({
				batchId: String(form.get("batchId")),
				reason: String(form.get("reason")),
				byUserId: user.id,
				// The batchId is form-supplied: the service rejects a batch that
				// belongs to another warehouse than the one we are lead-gated for.
				warehouseId,
			})
			return { ok: true }
		}
		case "regenerate_doc": {
			await requireWarehouseLead(request, warehouseId)
			await generateRepairBatchDocument(
				String(form.get("batchId")),
				warehouseId,
			)
			return { ok: true }
		}
		case "correct_triage": {
			// Pulling a unit back out of the repair pool is a lead judgment call
			// (spec §5), same authority as sending/voiding a batch.
			await requireWarehouseLead(request, warehouseId)
			await correctTriage({
				serial: String(form.get("serial")),
				reason: String(form.get("reason")),
				byUserId: user.id,
				warehouseId,
			})
			return { ok: true }
		}
		case "receive_intake": {
			const declaredCount = Number(form.get("declaredCount"))
			const mismatchNote = form.get("mismatchNote")
				? String(form.get("mismatchNote"))
				: undefined
			// Each scan line is "serial,claroCode"; resolve the Claro code → its
			// ServiceCode.id at this boundary before calling the service.
			const lines = String(form.get("scans") ?? "")
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean)
			const scans: { serial: string; serviceCodeId: string }[] = []
			for (const line of lines) {
				const [serial, claroCode] = line.split(",").map((s) => s.trim())
				if (!serial || !claroCode) continue
				const code = await db.serviceCode.findUnique({
					where: { claroCode },
					select: { id: true },
				})
				if (!code) throw new Error(`unknown Claro code: ${claroCode}`)
				scans.push({ serial, serviceCodeId: code.id })
			}
			const { intakeId, flagged } = await receiveRepairedUnits({
				warehouseId,
				declaredCount,
				scans,
				mismatchNote,
				byUserId: user.id,
			})
			return { ok: true, intakeId, flagged }
		}
		default:
			throw new Response("Unknown intent", { status: 400 })
	}
}

export default function Repairs({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const { pool, batches, onHand, intakes } = loaderData
	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 p-4">
			<h1 className="text-lg font-semibold text-foreground">
				{t("repairs.title")}
			</h1>

			{actionData?.errorKey && (
				<div
					data-testid="repairs-error"
					className="rounded-lg border border-status-danger/40 bg-status-danger/10 p-2.5 text-sm text-status-danger"
				>
					{t(actionData.errorKey)}
					{actionData.errorDetail ? `: ${actionData.errorDetail}` : ""}
				</div>
			)}
			{actionData?.batchId && (
				<div className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
					{t("repairs.batch_sent", { id: actionData.batchId.slice(0, 8) })}
					{actionData.docFailed ? ` — ${t("repairs.doc_failed")}` : ""}
				</div>
			)}
			{actionData?.flagged && actionData.flagged.length > 0 && (
				<div className="rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-sm">
					{t("repairs.flagged", { serials: actionData.flagged.join(", ") })}
				</div>
			)}

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t("repairs.pool_heading", { count: pool.length })}
				</h2>
				{pool.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("repairs.pool_empty")}
					</p>
				) : (
					<Form method="post" className="space-y-2">
						<input type="hidden" name="intent" value="create_batch" />
						<Card>
							<CardContent className="space-y-1 p-3">
								{pool.map((u) => (
									<label
										key={u.serial}
										className="flex items-center gap-2 text-sm"
									>
										<input
											type="checkbox"
											name="serial"
											value={u.serial}
											data-testid={`pool-select-${u.serial}`}
										/>
										<span className="font-mono">{u.serial}</span>
									</label>
								))}
							</CardContent>
						</Card>
						<div className="flex items-end gap-2">
							<label className="flex-1 text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("repairs.claro_reference")}
								</span>
								<input
									type="text"
									name="claroReference"
									className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
								/>
							</label>
							<Button type="submit">{t("repairs.create_batch")}</Button>
						</div>
					</Form>
				)}
			</section>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t("repairs.batches_heading", { count: batches.length })}
				</h2>
				{batches.map((b) => (
					<Card key={b.id}>
						<CardContent className="flex items-center justify-between gap-2 p-3 text-sm">
							<div>
								<span className="font-mono">{b.id.slice(0, 8)}</span>{" "}
								<Badge variant={b.status === "VOIDED" ? "danger" : "info"}>
									{b.status}
								</Badge>
							</div>
							<div className="flex items-center gap-2">
								{b.status === "SENT" && (
									<Form method="post">
										<input type="hidden" name="intent" value="regenerate_doc" />
										<input type="hidden" name="batchId" value={b.id} />
										<Button type="submit" variant="outline">
											{b.documentPath
												? t("repairs.regenerate")
												: t("repairs.generate_doc")}
										</Button>
									</Form>
								)}
								{b.status === "SENT" && (
									<Form method="post" className="flex items-center gap-1">
										<input type="hidden" name="intent" value="void_batch" />
										<input type="hidden" name="batchId" value={b.id} />
										<input
											type="text"
											name="reason"
											required
											placeholder={t("repairs.void_reason")}
											className="rounded-md border border-border bg-background px-2 py-1 text-xs"
										/>
										<Button type="submit" variant="destructive">
											{t("repairs.void")}
										</Button>
									</Form>
								)}
							</div>
						</CardContent>
					</Card>
				))}
			</section>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">{t("repairs.intake_heading")}</h2>
				<Form method="post" className="space-y-2">
					<input type="hidden" name="intent" value="receive_intake" />
					<Card>
						<CardContent className="space-y-2 p-3">
							<label className="block text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("repairs.declared_count")}
								</span>
								<input
									type="number"
									name="declaredCount"
									min={0}
									className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
								/>
							</label>
							<label className="block text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("repairs.scans_label")}
								</span>
								<textarea
									name="scans"
									rows={4}
									placeholder="serial,claroCode"
									className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
								/>
							</label>
							<label className="block text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("repairs.mismatch_note")}
								</span>
								<input
									type="text"
									name="mismatchNote"
									className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
								/>
							</label>
							<Button type="submit">{t("repairs.receive")}</Button>
						</CardContent>
					</Card>
				</Form>
			</section>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">{t("repairs.onhand_heading")}</h2>
				<Card>
					<CardContent className="space-y-1 p-3 text-sm">
						{onHand.length === 0 ? (
							<p className="text-muted-foreground">
								{t("repairs.onhand_empty")}
							</p>
						) : (
							onHand.map((r) => (
								<div
									key={`${r.serviceCodeId}-${r.condition}`}
									className="flex justify-between"
								>
									<span className="font-mono">
										{r.serviceCodeId.slice(0, 8)}
									</span>
									<span>
										{r.condition} · {r.count}
									</span>
								</div>
							))
						)}
					</CardContent>
				</Card>
				{intakes.length > 0 && (
					<p className="text-xs text-muted-foreground/70">
						{t("repairs.recent_intakes", { count: intakes.length })}
					</p>
				)}
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
