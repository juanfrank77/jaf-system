import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.reports"

export const meta: Route.MetaFunction = () => [{ title: "Reports — JAF Ops" }]

/** Reports Carmen sent to this person. Opening one stamps "Opened" on her side. */
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["ADMIN"])
	const open = new URL(request.url).searchParams.get("open")
	if (open)
		await db.sentReport.updateMany({
			where: { id: open, toId: user.id, openedAt: null },
			data: { openedAt: new Date() },
		})
	const reports = await db.sentReport.findMany({
		where: { toId: user.id },
		orderBy: { sentAt: "desc" },
		take: 50,
		include: { from: { select: { name: true } } },
	})
	return {
		open: reports.find((r) => r.id === open)?.id ?? null,
		reports: reports.map((r) => ({
			id: r.id,
			title: r.title,
			note: r.note,
			from: r.from.name,
			sentAt: r.sentAt.toISOString(),
		})),
	}
}

export default function Reports({ loaderData }: Route.ComponentProps) {
	const { reports, open } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4 p-6">
			<h1 className="text-2xl font-bold">{t("reports.title")}</h1>
			{open ? (
				<iframe
					title={t("reports.viewer")}
					src={`/files/reports/${open}.pdf`}
					className="h-[70vh] w-full rounded-lg border"
					// A PDF page is paper: white in dark mode too.
					style={{ background: "white" }}
				/>
			) : null}
			<Card>
				<CardContent className="p-0">
					{reports.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("reports.empty")}
						</p>
					) : (
						<ul className="divide-y text-sm">
							{reports.map((r) => (
								<li
									key={r.id}
									className="flex flex-wrap items-center gap-3 p-3"
								>
									<div className="min-w-0 flex-1">
										<p className="font-medium">{r.title}</p>
										<p className="text-muted-foreground">
											{t("reports.from", {
												name: r.from,
												date: formatShortDate(r.sentAt),
											})}
											{r.note ? ` · “${r.note}”` : ""}
										</p>
									</div>
									<Link
										to={`/reports?open=${r.id}`}
										className={buttonVariants({
											variant: "outline",
											size: "sm",
										})}
									>
										{t("reports.open")}
									</Link>
									<a
										href={`/files/reports/${r.id}.pdf`}
										download
										className={buttonVariants({ variant: "ghost", size: "sm" })}
									>
										{t("reports.download")}
									</a>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
