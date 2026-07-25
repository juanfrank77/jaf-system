import { redirect } from "react-router"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/action.notifications.mark-all-read"

export async function action({ request }: Route.ActionArgs) {
	const session = await requireSession(request)
	const formData = await request.formData()
	const raw = String(formData.get("redirectTo") ?? "/dashboard")
	const redirectTo =
		raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard"

	await db.notification.updateMany({
		where: { userId: session.user.id, read: false },
		data: { read: true },
	})

	throw redirect(redirectTo)
}
