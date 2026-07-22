import { redirect } from "react-router"
import { auth } from "~/lib/auth.server"
import type { Route } from "./+types/action.sign-out"

export async function action({ request }: Route.ActionArgs) {
	const { headers } = await auth.api.signOut({
		headers: request.headers,
		returnHeaders: true,
	})
	throw redirect("/login", { headers })
}
