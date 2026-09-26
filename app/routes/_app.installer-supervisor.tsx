import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getInstallerRollup } from "~/lib/van-view.server"
import type { Route } from "./+types/_app.installer-supervisor"

const OWED_BACK_AGING_DAYS = 7

export const meta: Route.MetaFunction = () => [
	{ title: "Installer Supervisor — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["INSTALLER_SUPERVISOR", "ADMIN"])
	const rollup = await getInstallerRollup()

	const supervisors = await db.user.findMany({
		where: {
			role: { in: ["INSTALLER_SUPERVISOR", "WAREHOUSE"] },
			active: true,
		},
		select: { id: true },
	})

	// Every aged owed-back serial × every supervisor, deduped against what's
	// already been sent — computed in memory from one batch read, written in
	// one batch insert, instead of a findFirst+create pair per (serial,
	// supervisor) on every GET of this page. Deduped by a stable docId (the
	// serial), not by the message string: the message embeds sinceDays, which
	// increments daily, so keying on it would never match yesterday's row and
	// would re-notify every supervisor every day past the threshold forever.
	const agedSerials = rollup
		.flatMap((r) => r.owedBackDetails)
		.filter((o) => o.sinceDays > OWED_BACK_AGING_DAYS)
	const docIds = agedSerials.map((o) => `owed-back:${o.serial}`)

	if (docIds.length > 0 && supervisors.length > 0) {
		const existing = await db.notification.findMany({
			where: {
				userId: { in: supervisors.map((s) => s.id) },
				docId: { in: docIds },
			},
			select: { userId: true, docId: true },
		})
		const existingKeys = new Set(existing.map((e) => `${e.userId}::${e.docId}`))
		const toCreate = supervisors.flatMap((s) =>
			agedSerials
				.filter((o) => !existingKeys.has(`${s.id}::owed-back:${o.serial}`))
				.map((o) => ({
					userId: s.id,
					docId: `owed-back:${o.serial}`,
					message: `Serial ${o.serial} owed back for ${o.sinceDays} days.`,
				})),
		)
		if (toCreate.length > 0) {
			await db.notification.createMany({ data: toCreate })
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
