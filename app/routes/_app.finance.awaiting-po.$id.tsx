import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-po.$id"

/** An old PO link opens that PO on Review. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireSession(request)
	return redirect(`/finance/claro/${params.id}?step=review`)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
