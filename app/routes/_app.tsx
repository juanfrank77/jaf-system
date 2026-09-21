import { Outlet } from "react-router"
import { AppShell } from "~/components/app-shell"
import { DesignSystemAppShell } from "~/components/design-system/app-shell"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { db } from "~/lib/db.server"
import { isComptrollerEnabled, isDsShellEnabled } from "~/lib/features.server"
import { requireSession } from "~/lib/permissions.server"
import { getTheme } from "~/lib/theme.server"
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
	const theme = await getTheme(request)
	return {
		user: { id: user.id, name: user.name, role: user.role, image: user.image },
		notifications,
		comptrollerEnabled: isComptrollerEnabled(),
		theme,
		dsShell: isDsShellEnabled(),
	}
}

export default function AppShellRoute({ loaderData }: Route.ComponentProps) {
	const { user, notifications, comptrollerEnabled, theme, dsShell } = loaderData
	if (dsShell) {
		return (
			<DesignSystemAppShell
				user={user}
				notifications={notifications}
				comptrollerEnabled={comptrollerEnabled}
				theme={theme}
			>
				<Outlet />
			</DesignSystemAppShell>
		)
	}
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
