import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { requireInstaller } from "~/lib/installer-context.server"
import type { Route } from "./+types/_app.installer._index"

export const meta: Route.MetaFunction = () => [{ title: "Installer — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user, van } = await requireInstaller(request)
	return { installer: user, van }
}

export default function InstallerHome({ loaderData }: Route.ComponentProps) {
	const { installer, van } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-xl font-semibold">{installer.name}</h1>
				<p className="text-sm text-slate-500">
					{van ? van.name : t("installer.no_van")}
				</p>
			</div>
			<Link
				to="/installer/completion/new"
				className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
			>
				＋ {t("installer.completion.new_heading", "New Completion")}
			</Link>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
