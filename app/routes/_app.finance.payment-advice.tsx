import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payment-advice"

/** Payment Advice is now Close, step 5 of the Claro path. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireSession(request)
	return redirect("/finance/claro/close")
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
