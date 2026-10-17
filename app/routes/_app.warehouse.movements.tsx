import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MovementLog } from "~/components/movement-log"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { paginate } from "~/lib/pagination"
import { requireRole } from "~/lib/permissions.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.movements"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.movement_log") },
]

const PAGE_SIZE = 20

// The warehouse's ledger, newest first: every stock movement (bulk and
// serial) with who, when, what and which job. The per-material trail on
// Stock & audit is this, filtered to one material.
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId } = await resolveWarehouseScope(db, request, user)
	if (!selectedId) return { selectedId, movements: [], paging: null }

	const where = { warehouseId: selectedId }
	const total = await db.stockMovement.count({ where })
	const paging = paginate(
		new URL(request.url).searchParams.get("page"),
		total,
		PAGE_SIZE,
	)
	const rows = await db.stockMovement.findMany({
		where,
		orderBy: [{ at: "desc" }, { id: "desc" }],
		skip: paging.skip,
		take: paging.take,
		include: { byUser: { select: { name: true } } },
	})
	const [codes, docs] = await Promise.all([
		db.serviceCode.findMany({
			where: { id: { in: [...new Set(rows.map((m) => m.serviceCodeId))] } },
			select: { id: true, claroCode: true, canonicalName: true, name: true },
		}),
		db.jafInvoice.findMany({
			where: {
				id: {
					in: [
						...new Set(
							rows.map((m) => m.refDocId).filter((id): id is string => !!id),
						),
					],
				},
			},
			select: { id: true, controlNumber: true },
		}),
	])
	const codeById = new Map(codes.map((c) => [c.id, c]))
	const controlById = new Map(docs.map((d) => [d.id, d.controlNumber]))
	return {
		selectedId,
		paging: {
			page: paging.page,
			pageCount: paging.pageCount,
			total,
			pageSize: PAGE_SIZE,
		},
		movements: rows.map((m) => {
			const code = codeById.get(m.serviceCodeId)
			return {
				id: m.id,
				type: m.type,
				qty: m.qty,
				serial: m.serial,
				at: m.at.toISOString(),
				actor: m.byUser.name,
				material: code
					? `${code.claroCode} ${code.canonicalName ?? code.name}`.trim()
					: "",
				job: m.refDocId ? (controlById.get(m.refDocId) ?? null) : null,
				note: m.note,
			}
		}),
	}
}

export default function WarehouseMovements({
	loaderData,
}: Route.ComponentProps) {
	const { selectedId, movements, paging } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_movements")} />
			{selectedId && paging ? (
				<MovementLog
					movements={movements}
					page={paging.page}
					pageCount={paging.pageCount}
					total={paging.total}
					pageSize={paging.pageSize}
					hrefFor={(page) => `?page=${page}`}
				/>
			) : (
				<p className="text-sm text-muted-foreground">
					{t("stock.no_warehouse")}
				</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
