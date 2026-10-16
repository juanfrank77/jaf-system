import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { SerialRegister } from "~/components/serial-register"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { requireRole } from "~/lib/permissions.server"
import { getSerialRegisterPage } from "~/lib/serial-register.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.serials"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.serial_register") },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { selectedId } = await resolveWarehouseScope(db, request, user)
	if (!selectedId) return { selectedId, register: null }
	const register = await getSerialRegisterPage(
		db,
		selectedId,
		new URL(request.url).searchParams.get("page"),
	)
	return { selectedId, register }
}

export default function WarehouseSerials({ loaderData }: Route.ComponentProps) {
	const { register } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("app_shell.nav.warehouse_serials")} />
			{register ? (
				<SerialRegister {...register} hrefFor={(page) => `?page=${page}`} />
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
