import { redirect } from "react-router"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/action.notifications.$id.read"

export async function action({ request, params }: Route.ActionArgs) {
	const session = await requireSession(request)
	const formData = await request.formData()
	const redirectTo = String(formData.get("redirectTo") ?? "/dashboard")

	const notification = await db.notification.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (notification.userId !== session.user.id) {
		throw new Response("Forbidden", { status: 403 })
	}

	await db.notification.update({
		where: { id: params.id },
		data: { read: true },
	})

	throw redirect(
		notification.docId ? `/docs/${notification.docId}` : redirectTo,
	)
}
