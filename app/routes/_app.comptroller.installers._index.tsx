import { useTranslation } from "react-i18next"
import { Form, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FileViewerLink } from "~/components/file-viewer"
import { InstallerStepper } from "~/components/installer-stepper"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { loadWarrantyDocs } from "~/lib/ewit.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import { uploadHref } from "~/lib/upload-href"
import type { Route } from "./+types/_app.comptroller.installers._index"

export const meta: Route.MetaFunction = () => [
	{ title: "Warranty docs — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const url = new URL(request.url)
	const q = (url.searchParams.get("q") ?? "").trim().toLowerCase()
	const installerId = url.searchParams.get("installer") ?? ""
	const all = await loadWarrantyDocs()
	const installers = [
		...new Map(all.map((d) => [d.installerId, d.installerName])).entries(),
	].map(([id, name]) => ({ id, name }))
	const docs = all
		.filter((d) => !installerId || d.installerId === installerId)
		.filter((d) => !q || d.orderNo.toLowerCase().includes(q))
		.map((d) => ({
			...d,
			installedAt: d.installedAt.toISOString(),
			photoHref: d.photoPath ? uploadHref(d.photoPath) : null,
			photoPath: undefined,
		}))
	return { docs, installers, total: all.length }
}

export default function WarrantyDocs({ loaderData }: Route.ComponentProps) {
	const { docs, installers, total } = loaderData
	const { t } = useTranslation()
	const [params] = useSearchParams()
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current="warranty" />
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<h1 className="text-2xl font-bold">{t("installers.warranty.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("installers.warranty.subtitle")} ·{" "}
					{t("installers.warranty.count", { count: total })}
				</p>
			</div>
			<Form method="get" className="flex flex-wrap items-center gap-2 text-sm">
				<Input
					name="q"
					defaultValue={params.get("q") ?? ""}
					placeholder={t("installers.warranty.search")}
					aria-label={t("installers.warranty.search")}
					className="w-56"
				/>
				<select
					name="installer"
					defaultValue={params.get("installer") ?? ""}
					aria-label={t("installers.warranty.col_installer")}
					className="rounded border bg-background px-2 py-2"
				>
					<option value="">{t("installers.warranty.all_installers")}</option>
					{installers.map((i) => (
						<option key={i.id} value={i.id}>
							{i.name}
						</option>
					))}
				</select>
				<Button type="submit" variant="outline" size="sm">
					{t("installers.warranty.search")}
				</Button>
			</Form>
			<Card>
				<CardContent className="p-0">
					{docs.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("installers.warranty.empty")}
						</p>
					) : (
						<table className="w-full text-sm">
							<thead className="border-b bg-muted text-left text-muted-foreground">
								<tr>
									<th className="p-2">{t("installers.warranty.col_order")}</th>
									<th className="p-2">
										{t("installers.warranty.col_installer")}
									</th>
									<th className="p-2">{t("installers.warranty.col_emp")}</th>
									<th className="p-2">
										{t("installers.warranty.col_installed")}
									</th>
									<th className="p-2">{t("installers.warranty.col_modem")}</th>
									<th className="p-2">{t("installers.warranty.col_photo")}</th>
									<th className="p-2 text-right">
										{t("installers.warranty.col_waiting")}
									</th>
								</tr>
							</thead>
							<tbody>
								{docs.map((d) => (
									<tr key={d.id} className="border-b last:border-0">
										<td className="p-2 font-mono">
											{d.orderNo}{" "}
											{d.duplicate ? (
												<Badge variant="warn">
													{t("installers.warranty.duplicate")}
												</Badge>
											) : null}
										</td>
										<td className="p-2">{d.installerName}</td>
										<td className="p-2 font-mono">{d.empNo ?? "—"}</td>
										<td className="p-2">{formatShortDate(d.installedAt)}</td>
										<td className="p-2 font-mono text-xs">{d.modem ?? "—"}</td>
										<td className="p-2">
											{d.photoHref ? (
												<FileViewerLink
													href={d.photoHref}
													label={t("installers.warranty.photo_open")}
													title={t("installers.warranty.viewer_title", {
														order: d.orderNo,
													})}
												/>
											) : (
												<span className="text-muted-foreground">
													{t("installers.warranty.no_photo")}
												</span>
											)}
										</td>
										<td className="p-2 text-right">
											{d.stale ? (
												<Badge variant="warn">
													{d.daysWaiting} ·{" "}
													{t("installers.warranty.stale_hint")}
												</Badge>
											) : (
												d.daysWaiting
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
