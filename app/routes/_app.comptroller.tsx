import { useTranslation } from "react-i18next"
import { ComptrollerHomeView } from "~/components/comptroller-home"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { loadComptrollerHome } from "~/lib/comptroller-home.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller"

export const meta: Route.MetaFunction = () => [{ title: "Home — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const home = await loadComptrollerHome(new Date())
	return { user, home }
}

export default function ComptrollerHome({ loaderData }: Route.ComponentProps) {
	const { i18n } = useTranslation()
	const today = new Date().toLocaleDateString(i18n.language, {
		timeZone: "America/Puerto_Rico",
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	})
	return (
		<ComptrollerHomeView
			home={loaderData.home}
			name={loaderData.user.name.split(" ")[0] ?? ""}
			today={today}
		/>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
