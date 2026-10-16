import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialRequestsTable } from "~/components/material-requests-table"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { paginate } from "~/lib/pagination"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.requests"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.material_requests") },
]

const PAGE_SIZE = 20

// Every van restock request, newest first. Restock (`/warehouse/restock`) is
// the action queue of the pending ones; this is the full list, with the
// release link only where a release is still due.
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const where = { status: { not: "DRAFT" as const } }
	const total = await db.restockRequest.count({ where })
	const paging = paginate(
		new URL(request.url).searchParams.get("page"),
		total,
		PAGE_SIZE,
	)
	const rows = await db.restockRequest.findMany({
		where,
		include: { van: true },
		orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
		skip: paging.skip,
		take: paging.take,
	})
	const requests = rows.map((r) => {
		const lines = (r.lines as { qty: number }[] | null) ?? []
		return {
			id: r.id,
			vanName: r.van.name,
			status: r.status,
			submittedAt: r.submittedAt.toISOString(),
			materialCount: lines.length,
			unitCount: lines.reduce((sum, l) => sum + l.qty, 0),
		}
	})
	return { requests, paging: { ...paging, total, pageSize: PAGE_SIZE } }
}

export default function WarehouseRequests({
	loaderData,
}: Route.ComponentProps) {
	const { requests, paging } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_requests")} />
			<MaterialRequestsTable
				requests={requests}
				page={paging.page}
				pageCount={paging.pageCount}
				total={paging.total}
				pageSize={paging.pageSize}
				hrefFor={(page) => `?page=${page}`}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
