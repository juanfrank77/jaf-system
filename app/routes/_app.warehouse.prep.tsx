import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { WarehouseDocList } from "~/components/warehouse-doc-list"
import { WarehouseQueuePage } from "~/components/warehouse-queue-page"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import {
	warehouseMissingWhere,
	warehouseQueueWhere,
} from "~/lib/warehouse-queues.server"
import type { Route } from "./+types/_app.warehouse.prep"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.warehouse_prep") },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const [docs, missing] = await Promise.all([
		db.jafInvoice.findMany({
			where: warehouseQueueWhere("prep"),
			orderBy: { createdAt: "desc" },
			take: 50,
		}),
		db.jafInvoice.findMany({
			where: warehouseMissingWhere,
			orderBy: { createdAt: "desc" },
			take: 50,
		}),
	])
	return { docs, missing }
}

export default function WarehousePrep({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { docs, missing } = loaderData
	return (
		<WarehouseQueuePage
			titleKey="app_shell.nav.warehouse_prep"
			kind="prep"
			docs={docs}
		>
			{missing.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-semibold text-foreground">
						{t("warehouse_queue.missing_heading")}
					</h2>
					<WarehouseDocList docs={missing} kind="missing" />
				</section>
			)}
		</WarehouseQueuePage>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
