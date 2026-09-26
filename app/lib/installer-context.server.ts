import { redirect } from "react-router"
import { db } from "./db.server"
import { requireRole } from "./permissions.server"

export async function requireInstaller(request: Request) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const profile = await db.installerProfile.findUnique({
		where: { userId: user.id },
	})
	if (!profile && user.role === "INSTALLER") throw redirect("/dashboard")
	const van = await db.van.findFirst({ where: { installerId: user.id } })
	return { user, profile, van }
}
