import { Outlet } from "react-router"
import { AppShell } from "~/components/app-shell"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { db } from "~/lib/db.server"
import { isComptrollerEnabled } from "~/lib/features.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const notifications = await db.notification.findMany({
		where: { userId: session.user.id, read: false },
		orderBy: { createdAt: "desc" },
		take: 10,
	})
	return {
		user: { name: user.name, role: user.role },
		notifications,
		comptrollerEnabled: isComptrollerEnabled(),
	}
}

export default function AppShellRoute({ loaderData }: Route.ComponentProps) {
	const { user, notifications, comptrollerEnabled } = loaderData
	return (
		<AppShell
			user={user}
			notifications={notifications}
			comptrollerEnabled={comptrollerEnabled}
		>
			<Outlet />
		</AppShell>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
