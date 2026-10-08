import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerLoopRail } from "~/components/installer-loop-rail"
import { Badge } from "~/components/ui/badge"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { getVanView } from "~/lib/van-view.server"
import type { Route } from "./+types/_app.installer._index"

export const meta: Route.MetaFunction = () => [{ title: "Installer — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user, van } = await requireInstaller(request)
	const requests = await db.paymentRequest.findMany({
		where: { installerId: user.id },
		orderBy: { createdAt: "desc" },
		take: 10,
	})
	const completions = await db.installCompletion.findMany({
		where: { id: { in: requests.map((r) => r.completionId ?? "") } },
	})
	const orderByCompletion = Object.fromEntries(
		completions.map((c) => [c.id, c.claroOrderNo]),
	)
	const jobs = requests.map((r) => ({
		id: r.id,
		claroOrderNo: r.completionId
			? (orderByCompletion[r.completionId] ?? "—")
			: "—",
		kind: r.kind,
		pill: r.status,
	}))
	const view = van
		? await getVanView(van.id)
		: { serialized: [], accessories: [], owedBack: [] }
	const belowPar = [...view.serialized, ...view.accessories].filter(
		(r) => r.par != null && r.onVan < r.par,
	).length
	return {
		installer: user,
		van,
		jobs,
		quickLook: { belowPar, owedBack: view.owedBack.length },
	}
}

// Raw enum -> badge tone; the words come from installer.home.status.*.
const STATUS_VARIANT: Record<string, "ok" | "warn" | "info"> = {
	INCOMPLETE: "warn",
	READY: "info",
	PAID: "ok",
}

export default function InstallerHome({ loaderData }: Route.ComponentProps) {
	const { installer, van, jobs, quickLook } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-6">
			<InstallerLoopRail current="HOME" />
			<Callout title={t("installer.installer_flow.callout.home_title")}>
				{t("installer.installer_flow.callout.home_body")}
			</Callout>
			<div>
				<h1 className="text-xl font-semibold">{installer.name}</h1>
				<p className="text-sm text-muted-foreground">
					{van ? van.name : t("installer.no_van")}
				</p>
				<p className="text-xs text-muted-foreground">
					{t(
						"installer.quick_look",
						"{{belowPar}} below par · {{owedBack}} owed back",
						{
							belowPar: quickLook.belowPar,
							owedBack: quickLook.owedBack,
						},
					)}
				</p>
			</div>

			<div className="flex flex-wrap gap-2">
				<Link
					to="/installer/completion/new"
					className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
				>
					＋ {t("installer.completion.new_heading", "New Completion")}
				</Link>
				<Link
					to="/installer/swap"
					className="inline-flex min-h-11 items-center rounded-md border px-4 py-2 text-sm font-medium"
				>
					⟲ {t("installer.swap.heading", "Warranty Swap")}
				</Link>
				<Link
					to="/installer/van"
					className="inline-flex min-h-11 items-center rounded-md border px-4 py-2 text-sm font-medium"
				>
					{t("installer.my_van_heading", "My Van")}
				</Link>
			</div>

			<div>
				<h2 className="text-sm font-medium mb-2">
					{t("installer.submitted_jobs_heading", "My submitted jobs")}
				</h2>
				{jobs.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						{t("installer.no_submitted_jobs", "No jobs submitted yet.")}
					</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="py-1 font-medium">
									{t("installer.home.col_order")}
								</th>
								<th className="py-1 font-medium">
									{t("installer.home.col_type")}
								</th>
								<th className="py-1 text-right font-medium">
									{t("installer.home.col_status")}
								</th>
							</tr>
						</thead>
						<tbody>
							{jobs.map((j) => (
								<tr key={j.id} className="border-b last:border-0">
									<td className="py-2.5 font-mono">{j.claroOrderNo}</td>
									<td className="py-2.5">
										{t(`installer.home.kind.${j.kind}`, {
											defaultValue: j.kind,
										})}
									</td>
									<td className="py-2.5 text-right">
										<Badge variant={STATUS_VARIANT[j.pill] ?? "neutral"}>
											{t(`installer.home.status.${j.pill}`, {
												defaultValue: j.pill,
											})}
										</Badge>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
