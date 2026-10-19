import { Outlet } from "react-router"
import { AppShell } from "~/components/app-shell"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { refuseCrew } from "~/lib/crew-notice.server"
import { db } from "~/lib/db.server"
import { isVarianceEnabled } from "~/lib/features.server"
import { loadNavCounts } from "~/lib/nav-counts.server"
import { requireSession } from "~/lib/permissions.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	refuseCrew(user.role)
	const notifications = await db.notification.findMany({
		where: { userId: session.user.id, read: false },
		orderBy: { createdAt: "desc" },
		take: 10,
	})
	// Warehouse/admin users get the multi-warehouse header switch (renders only
	// when they have >1 assignment).
	const warehouseScope =
		user.role === "WAREHOUSE" || user.role === "ADMIN"
			? await resolveWarehouseScope(db, request, user)
			: null
	const navCounts = await loadNavCounts(
		{ id: user.id, role: user.role },
		warehouseScope?.selectedId,
	)
	return {
		user: { name: user.name, role: user.role },
		notifications,
		varianceEnabled: isVarianceEnabled(),
		warehouseScope,
		navCounts,
	}
}

export default function AppShellRoute({ loaderData }: Route.ComponentProps) {
	const { user, notifications, varianceEnabled, warehouseScope, navCounts } =
		loaderData
	return (
		<AppShell
			user={user}
			notifications={notifications}
			varianceEnabled={varianceEnabled}
			warehouseScope={warehouseScope ?? undefined}
			navCounts={navCounts}
		>
			<Outlet />
		</AppShell>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
