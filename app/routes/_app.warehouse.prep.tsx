import { RouteErrorBoundary } from "~/components/error-boundary"
import { WarehouseQueuePage } from "~/components/warehouse-queue-page"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { warehouseQueueWhere } from "~/lib/warehouse-queues.server"
import type { Route } from "./+types/_app.warehouse.prep"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.warehouse_prep") },
]

// Only the work orders to prep. A job flagged short stays in this list; the
// flag itself is shown on the job's own prep screen.
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const docs = await db.jafInvoice.findMany({
		where: warehouseQueueWhere("prep"),
		orderBy: { createdAt: "desc" },
		take: 50,
	})
	return { docs }
}

export default function WarehousePrep({ loaderData }: Route.ComponentProps) {
	return (
		<WarehouseQueuePage
			titleKey="app_shell.nav.warehouse_prep"
			kind="prep"
			docs={loaderData.docs}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
