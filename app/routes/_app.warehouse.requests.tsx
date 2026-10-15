import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.requests"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.material_requests") },
]

const RECENT = 100

// Every van restock request, newest first. Restock (`/warehouse/restock`) is
// the action queue of the pending ones; this is the full list, with the
// release link only where a release is still due.
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const requests = await db.restockRequest.findMany({
		where: { status: { not: "DRAFT" } },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
		take: RECENT,
	})
	return { requests }
}

export default function WarehouseRequests({
	loaderData,
}: Route.ComponentProps) {
	const { requests } = loaderData
	const { t, i18n } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_requests")} />
			<ul className="divide-y">
				{requests.map((r) => {
					const pending = r.status === "SUBMITTED" || r.status === "APPROVED"
					return (
						<li
							key={r.id}
							className="flex items-center justify-between gap-2 py-2"
						>
							<span className="text-sm">
								{r.van.name} — {r.id.slice(-6)}
								<span className="block text-xs text-muted-foreground">
									{new Date(r.submittedAt).toLocaleString(i18n.language)}
								</span>
							</span>
							<span className="flex items-center gap-2">
								<Badge variant={pending ? "warn" : "info"}>
									{t(`restock_status.${r.status}`, r.status)}
								</Badge>
								{pending && (
									<Link
										to={`/restock/${r.id}/release`}
										className="text-sm underline"
									>
										{t("warehouse.restock_list.release", "Release")}
									</Link>
								)}
							</span>
						</li>
					)
				})}
				{requests.length === 0 && (
					<li className="py-2 text-sm text-muted-foreground">
						{t("warehouse.requests.empty")}
					</li>
				)}
			</ul>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
