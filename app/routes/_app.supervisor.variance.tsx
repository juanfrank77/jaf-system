import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { computeMaterialSignals } from "~/lib/dashboard-stats"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import { buildVarianceLines, collectVariance } from "~/lib/variance.server"
import type { Route } from "./+types/_app.supervisor.variance"

export const meta: Route.MetaFunction = () => [
	{ title: "Material Variance — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR"])
	const areas = await supervisorAreas(db, user.id)

	const docs = await db.jafInvoice.findMany({
		where: ownedOrInArea(user.id, areas),
		select: {
			id: true,
			controlNumber: true,
			estimatedMaterials: true,
			materialsTaken: true,
			materialsUsed: true,
			materialsReturned: true,
			brigade: { select: { name: true } },
		},
		orderBy: { createdAt: "desc" },
		take: 100,
	})

	const rows = collectVariance(
		docs.map((doc) => ({
			id: doc.id,
			claroOrderNo: doc.controlNumber,
			brigade: doc.brigade?.name ?? "",
			signals: computeMaterialSignals([
				{
					estimatedMaterials: doc.estimatedMaterials,
					materialsTaken: doc.materialsTaken,
					materialsUsed: doc.materialsUsed,
					materialsReturned: doc.materialsReturned,
				},
			]),
			lines: buildVarianceLines(doc),
		})),
	)

	return { rows }
}

export default function SupervisorVariance({
	loaderData,
}: Route.ComponentProps) {
	const { rows } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">
				{t("supervisor_variance.title")}
			</h1>
			<p className="text-sm text-slate-500">
				{t("supervisor_variance.readonly_note")}
			</p>

			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_variance.table.doc")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_variance.table.brigade")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_variance.table.kinds")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_variance.table.lines")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map((row) => (
							<tr key={row.docId} className="align-top hover:bg-slate-50">
								<td className="px-4 py-3 font-medium">
									<Link
										to={`/docs/${row.docId}/review`}
										className="text-blue-600 hover:underline"
									>
										{row.claroOrderNo}
									</Link>
								</td>
								<td className="px-4 py-3 text-slate-600">{row.brigade}</td>
								<td className="px-4 py-3">
									<div className="flex flex-wrap gap-1">
										{row.kinds.map((kind) => (
											<span
												key={kind}
												className={
													kind === "overage"
														? "rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
														: kind === "shortage"
															? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
															: "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
												}
											>
												{t(`supervisor_variance.kinds.${kind}`)}
											</span>
										))}
									</div>
								</td>
								<td className="px-4 py-3 text-slate-600">
									{row.lines.length === 0 ? (
										<span className="text-slate-400">
											{t("supervisor_variance.no_lines")}
										</span>
									) : (
										<table className="w-full text-xs">
											<thead>
												<tr className="text-slate-500">
													<th className="pr-3 text-left font-medium">
														{t("supervisor_variance.line.code")}
													</th>
													<th className="pr-3 text-left font-medium">
														{t("supervisor_variance.line.ordered")}
													</th>
													<th className="pr-3 text-left font-medium">
														{t("supervisor_variance.line.installed")}
													</th>
													<th className="text-left font-medium">
														{t("supervisor_variance.line.delta")}
													</th>
												</tr>
											</thead>
											<tbody>
												{row.lines.map((line) => (
													<tr key={line.code}>
														<td className="pr-3">{line.code}</td>
														<td className="pr-3">{line.ordered}</td>
														<td className="pr-3">{line.installed}</td>
														<td
															className={
																line.delta === 0
																	? ""
																	: line.delta > 0
																		? "text-blue-700 font-medium"
																		: "text-red-700 font-medium"
															}
														>
															{line.delta > 0 ? `+${line.delta}` : line.delta}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									)}
								</td>
							</tr>
						))}
						{rows.length === 0 && (
							<tr>
								<td
									colSpan={4}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("supervisor_variance.no_variance")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
