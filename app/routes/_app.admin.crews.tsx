import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import type { Route } from "./+types/_app.admin.crews"

export async function loader() {
	return redirect("/comptroller/brigades")
}

export async function action() {
	return redirect("/comptroller/brigades")
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
