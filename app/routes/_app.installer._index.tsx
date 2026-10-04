import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
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

export default function InstallerHome({ loaderData }: Route.ComponentProps) {
	const { installer, van, jobs, quickLook } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-6">
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
					className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
				>
					＋ {t("installer.completion.new_heading", "New Completion")}
				</Link>
				<Link
					to="/installer/swap"
					className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
				>
					⟲ {t("installer.swap.heading", "Warranty Swap")}
				</Link>
				<Link
					to="/installer/van"
					className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
				>
					{t("installer.my_van_heading", "My Van")}
				</Link>
			</div>

			<div>
				<h2 className="text-sm font-medium mb-2">
					{t("installer.submitted_jobs_heading", "My submitted jobs")}
				</h2>
				<ul className="divide-y">
					{jobs.map((j) => (
						<li
							key={j.id}
							className="py-2 flex items-center justify-between text-sm"
						>
							<span>{j.claroOrderNo}</span>
							<span className="rounded-full bg-muted px-2 py-0.5 text-xs">
								{j.pill}
							</span>
						</li>
					))}
					{jobs.length === 0 && (
						<li className="py-2 text-sm text-muted-foreground">
							{t("installer.no_submitted_jobs", "No jobs submitted yet.")}
						</li>
					)}
				</ul>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
