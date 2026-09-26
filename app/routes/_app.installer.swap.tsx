import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import type { Route } from "./+types/_app.installer.swap"

export const meta: Route.MetaFunction = () => [{ title: "Find Job — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireInstaller(request)
	const url = new URL(request.url)
	const q = url.searchParams.get("q")?.trim() ?? ""
	const results = q
		? await db.installCompletion.findMany({
				where: {
					installerId: user.id,
					OR: [
						{ claroOrderNo: { contains: q } },
						{ address: { contains: q, mode: "insensitive" } },
						{ serialInstalled: { contains: q } },
					],
				},
				orderBy: { createdAt: "desc" },
				take: 20,
			})
		: []
	return { q, results }
}

export default function SwapFind({ loaderData }: Route.ComponentProps) {
	const { q, results } = loaderData
	const { t } = useTranslation()
	const [query, setQuery] = useState(q)

	return (
		<div className="space-y-4 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("installer.swap.find_heading", "Find the original job")}
			</h1>
			<Form method="get" className="flex gap-2">
				<Input
					name="q"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t(
						"installer.swap.search_placeholder",
						"Order #, address, or serial",
					)}
				/>
			</Form>
			<ul className="divide-y">
				{results.map((r) => (
					<li key={r.id} className="py-2">
						<Link to={`/installer/swap/${r.id}`} className="text-sm underline">
							{r.claroOrderNo} — {r.address}
						</Link>
					</li>
				))}
				{q && results.length === 0 && (
					<li className="py-2 text-sm text-slate-500">
						{t("installer.swap.no_results", "No matching jobs")}
					</li>
				)}
			</ul>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
