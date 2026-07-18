import { Form, redirect, useActionData } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { auth } from "~/lib/auth.server"
import { checkRateLimit, clearRateLimit } from "~/lib/rate-limit.server"
import type { Route } from "./+types/_auth.login"

function getClientIp(request: Request) {
	const forwarded = request.headers.get("x-forwarded-for")
	if (forwarded) return forwarded.split(",")[0].trim()
	const cf = request.headers.get("cf-connecting-ip")
	return cf || "unknown"
}

export async function loader({ request }: Route.LoaderArgs) {
	const session = await auth.api.getSession({ headers: request.headers })
	if (session) throw redirect("/dashboard")
	return null
}

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const email = form.get("email") as string
	const clientIp = getClientIp(request)
	const rateKey = `${clientIp}:${email.toLowerCase()}`

	const { allowed, resetIn } = checkRateLimit(rateKey)
	if (!allowed) {
		return {
			error: `Too many login attempts. Try again in ${Math.ceil(resetIn / 1000)} seconds.`,
		}
	}

	const password = form.get("password") as string

	try {
		const { headers } = await auth.api.signInEmail({
			body: { email, password },
			headers: request.headers,
			returnHeaders: true,
		})
		clearRateLimit(rateKey)
		throw redirect("/dashboard", { headers })
	} catch (e) {
		if (e instanceof Response) throw e
		return { error: "Invalid email or password" }
	}
}

export default function LoginPage() {
	const data = useActionData<typeof action>()
	return (
		<>
			<h1 className="text-2xl font-bold mb-6 text-center">JAF Operations</h1>
			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						required
						autoComplete="email"
					/>
				</div>
				<div>
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						autoComplete="current-password"
					/>
				</div>
				{data?.error && <p className="text-sm text-red-600">{data.error}</p>}
				<Button type="submit" className="w-full">
					Sign In
				</Button>
			</Form>
		</>
	)
}
