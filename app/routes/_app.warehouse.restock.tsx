import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { EmptyState } from "~/components/ui/empty-state"
import { WarehouseStepRail } from "~/components/warehouse-step-rail"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.restock"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.restocks_to_release") },
]

const AGED_DAYS = 2

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const rows = await db.restockRequest.findMany({
		where: { status: { in: ["SUBMITTED", "APPROVED"] } },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
	})
	const now = Date.now()
	const pending = rows.map((r) => {
		const lines = (r.lines as { qty: number }[] | null) ?? []
		return {
			id: r.id,
			vanName: r.van.name,
			status: r.status,
			submittedAt: r.submittedAt.toISOString(),
			ageDays: Math.floor((now - r.submittedAt.getTime()) / 86_400_000),
			materialCount: lines.length,
			unitCount: lines.reduce((sum, l) => sum + l.qty, 0),
		}
	})
	return { pending }
}

export default function WarehouseRestockList({
	loaderData,
}: Route.ComponentProps) {
	const { pending } = loaderData
	const { t, i18n } = useTranslation()

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("warehouse.restock_list.heading", "Restocks to Release")}
			</h1>
			<WarehouseStepRail current="RESTOCK" />
			<Callout title={t("warehouse_flow.callout.restock_title")}>
				{t("warehouse_flow.callout.restock_body")}
			</Callout>
			{pending.length === 0 ? (
				<EmptyState>
					{t("warehouse.restock_list.empty", "No restocks pending release.")}
				</EmptyState>
			) : (
				<ul className="space-y-2">
					{pending.map((r) => (
						<li
							key={r.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
						>
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-base font-semibold">{r.vanName}</span>
									<Badge variant={r.status === "APPROVED" ? "info" : "warn"}>
										{t(`restock_status.${r.status}`, r.status)}
									</Badge>
									{r.ageDays >= AGED_DAYS && (
										<Badge variant="danger">
											{t("warehouse.restock_list.waiting_days", {
												count: r.ageDays,
											})}
										</Badge>
									)}
								</div>
								<p className="text-xs text-muted-foreground">
									<span className="font-mono">#{r.id.slice(-6)}</span>
									{" · "}
									{new Date(r.submittedAt).toLocaleDateString(i18n.language)}
									{" · "}
									{t("warehouse.restock_list.materials", {
										count: r.materialCount,
									})}
									{" · "}
									{t("warehouse.restock_list.units", { count: r.unitCount })}
								</p>
							</div>
							<Link
								to={`/restock/${r.id}/release`}
								className={buttonVariants({ size: "sm" })}
							>
								{t("warehouse.restock_list.release", "Release")}
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
