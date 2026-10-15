import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.movements"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.movement_log") },
]

const RECENT = 100

// The warehouse's ledger, newest first: every stock movement (bulk and
// serial) with who, when, what and which job. The per-material trail on
// Stock & audit is this, filtered to one material.
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId } = await resolveWarehouseScope(db, request, user)
	if (!selectedId) return { selectedId, movements: [] }

	const rows = await db.stockMovement.findMany({
		where: { warehouseId: selectedId },
		orderBy: { at: "desc" },
		take: RECENT,
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
	const { selectedId, movements } = loaderData
	const { t, i18n } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_movements")} />
			{!selectedId ? (
				<p className="text-sm text-muted-foreground">
					{t("stock.no_warehouse")}
				</p>
			) : movements.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("stock.trail.empty")}
				</p>
			) : (
				<ul className="divide-y text-sm">
					{movements.map((m) => (
						<li key={m.id} className="space-y-0.5 py-2">
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">
									{t(`stock.movement_type.${m.type}`, m.type)}
									{m.serial ? ` · ${m.serial}` : ""}
								</span>
								<span className="tabular-nums">{m.qty}</span>
							</div>
							<p className="text-xs text-muted-foreground">{m.material}</p>
							<p className="text-xs text-muted-foreground">
								{m.actor} · {new Date(m.at).toLocaleString(i18n.language)}
								{m.job ? ` · ${m.job}` : m.note ? ` · ${m.note}` : ""}
							</p>
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
