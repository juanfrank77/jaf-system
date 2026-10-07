import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Callout } from "~/components/ui/callout"
import { WarehouseStepRail } from "~/components/warehouse-step-rail"
import { db } from "~/lib/db.server"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.restock"

export const meta: Route.MetaFunction = () => [
	{ title: "Restocks to Release — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const pending = await db.restockRequest.findMany({
		where: { status: { in: ["SUBMITTED", "APPROVED"] } },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
	})
	return { pending }
}

export default function WarehouseRestockList({
	loaderData,
}: Route.ComponentProps) {
	const { pending } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("warehouse.restock_list.heading", "Restocks to Release")}
			</h1>
			<WarehouseStepRail current="RESTOCK" />
			<Callout title={t("warehouse_flow.callout.restock_title")}>
				{t("warehouse_flow.callout.restock_body")}
			</Callout>
			<ul className="divide-y">
				{pending.map((r) => (
					<li key={r.id} className="py-2 flex items-center justify-between">
						<span className="text-sm">
							{r.van.name} — {r.id.slice(-6)} —{" "}
							{t(`restock_status.${r.status}`, r.status)}
						</span>
						<Link to={`/restock/${r.id}/release`} className="text-sm underline">
							{t("warehouse.restock_list.release", "Release")}
						</Link>
					</li>
				))}
				{pending.length === 0 && (
					<li className="py-2 text-sm text-muted-foreground">
						{t("warehouse.restock_list.empty", "No restocks pending release.")}
					</li>
				)}
			</ul>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
