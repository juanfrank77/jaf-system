import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getInstallerRollup, getVanView } from "~/lib/van-view.server"
import type { Route } from "./+types/_app.installer-supervisor"

const OWED_BACK_AGING_DAYS = 7

export const meta: Route.MetaFunction = () => [
	{ title: "Installer Supervisor — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["INSTALLER_SUPERVISOR", "ADMIN"])
	const rollup = await getInstallerRollup()

	const vans = await db.van.findMany({ where: { active: true } })
	const supervisors = await db.user.findMany({
		where: {
			role: { in: ["INSTALLER_SUPERVISOR", "WAREHOUSE"] },
			active: true,
		},
		select: { id: true },
	})
	for (const v of vans) {
		const view = await getVanView(v.id)
		for (const o of view.owedBack) {
			if (o.sinceDays <= OWED_BACK_AGING_DAYS) continue
			const message = `Serial ${o.serial} owed back for ${o.sinceDays} days.`
			for (const s of supervisors) {
				const existing = await db.notification.findFirst({
					where: { userId: s.id, message },
				})
				if (!existing)
					await db.notification.create({ data: { userId: s.id, message } })
			}
		}
	}

	return { rollup }
}

export default function InstallerSupervisorRollup({
	loaderData,
}: Route.ComponentProps) {
	const { rollup } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("installer_supervisor.heading", "Installer Roll-up")}
			</h1>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-slate-500">
						<th className="px-3 py-1 font-medium">
							{t("installer_supervisor.installer", "Installer")}
						</th>
						<th className="px-3 py-1 font-medium text-right">
							{t("installer_supervisor.below_par", "Below par")}
						</th>
						<th className="px-3 py-1 font-medium text-right">
							{t("installer_supervisor.owed_back", "Owed back")}
						</th>
						<th className="px-3 py-1 font-medium">
							{t("installer_supervisor.last_completion", "Last completion")}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{rollup.map((r) => (
						<tr key={r.name}>
							<td className="px-3 py-2">{r.name}</td>
							<td className="px-3 py-2 text-right">{r.belowPar}</td>
							<td className="px-3 py-2 text-right">{r.owedBack}</td>
							<td className="px-3 py-2">
								{r.lastCompletionAt
									? new Date(r.lastCompletionAt).toLocaleDateString()
									: "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
