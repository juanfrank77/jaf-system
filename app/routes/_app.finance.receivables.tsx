import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.receivables"

/** Receivables gave way to the five-step Claro path; old links land on its queue. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireSession(request)
	return redirect("/finance/claro")
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
