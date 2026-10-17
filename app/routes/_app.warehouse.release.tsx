import { RouteErrorBoundary } from "~/components/error-boundary"
import { WarehouseQueuePage } from "~/components/warehouse-queue-page"
import { computeAwaitingPickup } from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { warehouseQueueWhere } from "~/lib/warehouse-queues.server"
import type { Route } from "./+types/_app.warehouse.release"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.warehouse_release") },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const docs = computeAwaitingPickup(
		await db.jafInvoice.findMany({
			where: warehouseQueueWhere("release"),
			orderBy: { createdAt: "desc" },
			take: 50,
		}),
	)
	return { docs }
}

export default function WarehouseRelease({ loaderData }: Route.ComponentProps) {
	const { docs } = loaderData
	return (
		<WarehouseQueuePage
			titleKey="app_shell.nav.warehouse_pickup"
			kind="release"
			docs={docs}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
