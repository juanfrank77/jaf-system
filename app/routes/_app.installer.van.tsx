import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerLoopRail } from "~/components/installer-loop-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { VanInventoryTable } from "~/components/van-inventory-table"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { getVanView } from "~/lib/van-view.server"
import type { Route } from "./+types/_app.installer.van"

export const meta: Route.MetaFunction = () => [{ title: "My Van — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { van } = await requireInstaller(request)
	if (!van) return { van: null, serialized: [], accessories: [], owedBack: [] }
	const view = await getVanView(van.id)
	const codes = await db.serviceCode.findMany({
		where: {
			id: {
				in: [...view.serialized, ...view.accessories].map(
					(r) => r.serviceCodeId,
				),
			},
		},
	})
	const labelById = Object.fromEntries(
		codes.map((c) => [c.id, `${c.claroCode} — ${c.name}`]),
	)
	return {
		van,
		serialized: view.serialized.map((r) => ({
			...r,
			label: labelById[r.serviceCodeId] ?? r.serviceCodeId,
		})),
		accessories: view.accessories.map((r) => ({
			...r,
			label: labelById[r.serviceCodeId] ?? r.serviceCodeId,
		})),
		owedBack: view.owedBack,
	}
}

export default function MyVan({ loaderData }: Route.ComponentProps) {
	const { van, serialized, accessories, owedBack } = loaderData
	const { t } = useTranslation()

	if (!van) {
		return <p className="text-sm text-status-warn">{t("installer.no_van")}</p>
	}

	return (
		<div className="space-y-6">
			<InstallerLoopRail current="VAN" />
			<Callout title={t("installer.installer_flow.callout.van_title")}>
				{t("installer.installer_flow.callout.van_body")}
			</Callout>
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("installer.my_van_heading", "My Van")}
				</h1>
				<Link to="/installer/restock">
					<Button variant="outline">
						{t("installer.request_restock", "Request Restock")}
					</Button>
				</Link>
			</div>
			<VanInventoryTable
				serialized={serialized}
				accessories={accessories}
				owedBack={owedBack}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
