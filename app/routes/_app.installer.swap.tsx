import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerLoopRail } from "~/components/installer-loop-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
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
	const now = Date.now()
	return {
		q,
		installerName: user.name,
		results: results.map((r) => {
			const installed = r.installedAt ?? r.createdAt
			return {
				id: r.id,
				claroOrderNo: r.claroOrderNo,
				address: r.address,
				serialInstalled: r.serialInstalled,
				installedAt: installed.toISOString(),
				// Same day count the swap itself records (swap-submit.server.ts).
				daysSince: Math.floor((now - installed.getTime()) / 86_400_000),
			}
		}),
	}
}

const WARRANTY_DAYS = 30

export default function SwapFind({ loaderData }: Route.ComponentProps) {
	const { q, results, installerName } = loaderData
	const { t, i18n } = useTranslation()
	const [query, setQuery] = useState(q)

	return (
		<div className="space-y-4 max-w-xl">
			<InstallerLoopRail current="SWAP" />
			<Callout title={t("installer.installer_flow.callout.swap_title")}>
				{t("installer.installer_flow.callout.swap_body")}
			</Callout>
			<h1 className="text-xl font-semibold">
				{t("installer.swap.find_heading", "Find the original job")}
			</h1>
			<Form method="get" className="space-y-2">
				<Label htmlFor="q">{t("installer.swap.search_label")}</Label>
				<div className="flex gap-2">
					<Input
						id="q"
						name="q"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="h-11 text-base"
						placeholder={t(
							"installer.swap.search_placeholder",
							"Order #, address, or serial",
						)}
					/>
					<Button type="submit" size="lg" className="h-11 text-base">
						{t("installer.swap.search")}
					</Button>
				</div>
			</Form>
			<ul className="space-y-3">
				{results.map((r) => {
					const inWarranty = r.daysSince <= WARRANTY_DAYS
					return (
						<li key={r.id} className="space-y-2 rounded-lg border bg-card p-3">
							<p className="text-sm">
								{t("installer.swap.order")}{" "}
								<b className="font-mono">{r.claroOrderNo}</b> · {r.address}
							</p>
							<p className="text-sm">
								{r.serialInstalled ? (
									<>
										{t("installer.swap.unit")}{" "}
										<b className="font-mono">{r.serialInstalled}</b> ·{" "}
									</>
								) : null}
								{t("installer.swap.installed_on_by", {
									date: new Date(r.installedAt).toLocaleDateString(
										i18n.language,
									),
									name: installerName,
								})}
							</p>
							<p
								className={
									inWarranty
										? "text-sm font-medium text-status-ok"
										: "text-sm font-medium text-status-warn"
								}
							>
								{t(
									inWarranty
										? "installer.swap.day_inside_warranty"
										: "installer.swap.day_outside_warranty",
									{ n: r.daysSince },
								)}
							</p>
							<Link
								to={`/installer/swap/${r.id}`}
								className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
							>
								{t("installer.swap.start")}
							</Link>
						</li>
					)
				})}
				{q && results.length === 0 && (
					<li className="py-2 text-sm text-muted-foreground">
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
