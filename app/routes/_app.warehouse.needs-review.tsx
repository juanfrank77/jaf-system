import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { resolveNeedsReview } from "~/lib/repair.server"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import { getActiveWarehouseId } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.needs-review"

export const meta: Route.MetaFunction = () => [
	{ title: "Needs Review — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const warehouseId = await getActiveWarehouseId(user.id)
	const units = await db.serialLocation.findMany({
		where: { status: "NEEDS_REVIEW", currentRef: warehouseId },
		select: { serial: true, serviceCodeId: true, since: true },
		orderBy: { since: "asc" },
	})
	return { units }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const warehouseId = await getActiveWarehouseId(user.id)
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
}

export default function NeedsReview({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { units } = loaderData
	return (
		<div className="mx-auto w-full max-w-2xl space-y-4 p-4">
			<h1 className="text-lg font-semibold text-foreground">
				{t("needs_review.title")}
			</h1>
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
