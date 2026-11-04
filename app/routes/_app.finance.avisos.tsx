import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { searchAvisos } from "~/lib/aviso-ledger.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.avisos"

/** Search any Aviso #; a single hit opens its record at once. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const q = new URL(request.url).searchParams.get("q")?.trim() ?? ""
	const results = await searchAvisos(q)
	if (results.length === 1) throw redirect(`/finance/avisos/${results[0].id}`)
	return { q, results }
}

export default function Avisos({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { q, results } = loaderData
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("aviso_record.search_title")}
			</h1>
			<Form method="get" className="flex items-center gap-2">
				<Input
					name="q"
					defaultValue={q}
					placeholder={t("aviso_record.search_placeholder")}
					aria-label={t("aviso_record.search_placeholder")}
					className="max-w-xs"
				/>
				<Button type="submit">{t("aviso_record.search")}</Button>
			</Form>
			{q && results.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("aviso_record.no_results")}
				</p>
			)}
			<ul className="space-y-1 text-sm">
				{results.map((r) => (
					<li key={r.id}>
						<Link to={`/finance/avisos/${r.id}`} className="underline">
							{r.avisoNumber ?? r.controlNumber}
						</Link>{" "}
						<span className="text-muted-foreground">
							{r.jobAddressEstimated}
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
