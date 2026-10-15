import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { SerialRegister } from "~/components/serial-register"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import { getWarehouseSerialStock } from "~/lib/warehouse-stock.server"
import type { Route } from "./+types/_app.warehouse.serials"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.serial_register") },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId } = await resolveWarehouseScope(db, request, user)
	if (!selectedId) {
		return {
			selectedId,
			serial: [],
			serialCodeNames: {} as Record<
				string,
				{ claroCode: string; name: string }
			>,
		}
	}
	const serial = await getWarehouseSerialStock(db, selectedId)
	// SerialLocation keys serviceCodeId without a relation (same convention as
	// triage.tsx), so resolve display names here.
	const codes = await db.serviceCode.findMany({
		where: { id: { in: [...new Set(serial.map((s) => s.serviceCodeId))] } },
		select: { id: true, claroCode: true, canonicalName: true, name: true },
	})
	const serialCodeNames = Object.fromEntries(
		codes.map((c) => [
			c.id,
			{ claroCode: c.claroCode, name: c.canonicalName ?? c.name },
		]),
	)
	return { selectedId, serial, serialCodeNames }
}

export default function WarehouseSerials({ loaderData }: Route.ComponentProps) {
	const { selectedId, serial, serialCodeNames } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_serials")} />
			{selectedId ? (
				<SerialRegister rows={serial} codeNames={serialCodeNames} />
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
