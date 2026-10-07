import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent } from "~/components/ui/card"
import { WarehouseStepRail } from "~/components/warehouse-step-rail"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { resolveNeedsReview } from "~/lib/repair.server"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.needs-review"

export const meta: Route.MetaFunction = () => [
	{ title: "Needs Review — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	// Honors the header warehouse switch (`wh` cookie) like every Spec B
	// screen; ADMIN resolves to all active warehouses rather than throwing.
	const { selectedId: warehouseId } = await resolveWarehouseScope(
		db,
		request,
		user,
	)
	if (!warehouseId) return { units: [] }
	const units = await db.serialLocation.findMany({
		where: { status: "NEEDS_REVIEW", currentRef: warehouseId },
		select: { serial: true, serviceCodeId: true, since: true },
		orderBy: { since: "asc" },
	})
	return { units }
}

/** One flat result shape for every branch, mirroring the repairs route. */
type NeedsReviewActionResult = {
	ok?: boolean
	errorKey?: "stock.no_warehouse" | "needs_review.action_failed"
	errorDetail?: string | null
}

export async function action({
	request,
}: Route.ActionArgs): Promise<NeedsReviewActionResult> {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId: warehouseId } = await resolveWarehouseScope(
		db,
		request,
		user,
	)
	if (!warehouseId) {
		return { errorKey: "stock.no_warehouse" as const, errorDetail: null }
	}
	// `resolveNeedsReview` throws a plain Error for every domain rejection (CAS
	// drift when a concurrent action already resolved the hold, cross-warehouse
	// ownership). Uncaught, those reached the error boundary as raw 500s — the
	// spec wants a clear message naming the drifted serial. Same translation the
	// repairs route does; the lead-gate redirect is a Response and passes through.
	try {
		// Resolving a held unit is a lead decision (spec §8).
		await requireWarehouseLead(request, warehouseId)
		const form = await request.formData()
		await resolveNeedsReview({
			serial: String(form.get("serial")),
			decision: String(form.get("decision")) as "FAILED" | "GOOD",
			reason: form.get("reason") ? String(form.get("reason")) : undefined,
			byUserId: user.id,
			warehouseId,
		})
		return { ok: true }
	} catch (e) {
		if (e instanceof Response) throw e // the requireWarehouseLead redirect
		if (e instanceof Error) {
			return {
				errorKey: "needs_review.action_failed" as const,
				errorDetail: e.message,
			}
		}
		throw e
	}
}

export default function NeedsReview({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const { units } = loaderData
	return (
		<div className="mx-auto w-full max-w-2xl space-y-4 p-4">
			<h1 className="text-lg font-semibold text-foreground">
				{t("needs_review.title")}
			</h1>
			<WarehouseStepRail current="REVIEW" />
			<Callout title={t("warehouse_flow.callout.review_title")} tone="warn">
				{t("warehouse_flow.callout.review_body")}
			</Callout>
			{actionData?.errorKey && (
				<div
					data-testid="needs-review-error"
					className="rounded-lg border border-status-danger/40 bg-status-danger/10 p-2.5 text-sm text-status-danger"
				>
					{t(actionData.errorKey)}
					{actionData.errorDetail ? `: ${actionData.errorDetail}` : ""}
				</div>
			)}
			{units.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("needs_review.empty")}
				</p>
			)}
			{units.map((u) => (
				<Card key={u.serial}>
					<CardContent className="space-y-2 p-4">
						<span className="font-mono font-medium">{u.serial}</span>
						<Form
							method="post"
							className="flex flex-col gap-2 sm:flex-row sm:items-end"
						>
							<input type="hidden" name="serial" value={u.serial} />
							<input
								type="text"
								name="reason"
								placeholder={t("needs_review.reason_placeholder")}
								className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
							/>
							<Button
								type="submit"
								name="decision"
								value="GOOD"
								variant="outline"
							>
								{t("needs_review.good")}
							</Button>
							<Button type="submit" name="decision" value="FAILED">
								{t("needs_review.failed")}
							</Button>
						</Form>
					</CardContent>
				</Card>
			))}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
