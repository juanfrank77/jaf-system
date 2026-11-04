import { useTranslation } from "react-i18next"
import { data, Form, Link, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import {
	buildLogReport,
	LOG_FILTER_KEYS,
	loadLogRows,
	logColumns,
} from "~/lib/log.server"
import {
	formatLogCell,
	logFileName,
	logViewQuery,
	MISSING,
} from "~/lib/log-view"
import { formatShortDate } from "~/lib/payroll-request-view"
import { generateLogPdf } from "~/lib/pdf/log-report.server"
import { requireRole } from "~/lib/permissions.server"
import { saveBuffer } from "~/lib/uploads.server"
import type { Route } from "./+types/_app.comptroller.log"

export const meta: Route.MetaFunction = () => [{ title: "Log — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const r = await buildLogReport(request)
	const all = await loadLogRows(r.tab)
	const options: Record<string, string[]> = {}
	for (const k of LOG_FILTER_KEYS[r.tab])
		options[k] = [
			...new Set(all.map((row) => String(row[k] ?? "")).filter(Boolean)),
		].sort()
	const sent = await db.sentReport.findMany({
		where: { fromId: user.id },
		orderBy: { sentAt: "desc" },
		take: 5,
		include: { to: { select: { name: true } } },
	})
	return {
		tab: r.tab,
		view: r.view,
		query: logViewQuery(r.view).toString(),
		allColumns: logColumns(r.tab),
		columns: r.result.columns,
		groups: r.result.groups,
		totals: r.result.totals,
		count: r.result.rows.length,
		options,
		sent: sent.map((s) => ({
			id: s.id,
			title: s.title,
			to: s.to.name,
			sentAt: s.sentAt.toISOString(),
			openedAt: s.openedAt?.toISOString() ?? null,
		})),
	}
}

/** Send to Monica: the same PDF as Print, put on her desk with a bell. */
export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "send_report")
		return data({ errorKey: "log.errors.unknown" as const }, 400)
	const qs = String(form.get("qs") ?? "")
	const r = await buildLogReport(new Request(`http://local/?${qs}`))
	if (r.result.rows.length === 0)
		return data({ errorKey: "log.errors.empty" as const }, 400)
	const recipients = await db.user.findMany({
		where: { role: "ADMIN", active: true },
		select: { id: true },
	})
	if (recipients.length === 0)
		return data({ errorKey: "log.errors.no_recipient" as const }, 400)
	const now = new Date()
	const bytes = await generateLogPdf(
		r.result,
		{
			title: r.title,
			printedBy: user.name,
			printedAt: now,
			filters: r.filters,
		},
		r.view.group !== "none",
	)
	const note =
		String(form.get("note") ?? "")
			.trim()
			.slice(0, 200) || null
	const title = `${r.tab === "brigades" ? "Brigades" : "Installers"} · ${r.filters}`
	for (const to of recipients) {
		const report = await db.sentReport.create({
			data: { title, note, pdfPath: "", fromId: user.id, toId: to.id },
		})
		const pdfPath = await saveBuffer("reports", `${report.id}.pdf`, bytes)
		await db.sentReport.update({ where: { id: report.id }, data: { pdfPath } })
		await db.notification.create({
			data: {
				userId: to.id,
				message: `${user.name} sent you a report: ${title}`,
				href: `/reports?open=${report.id}`,
			},
		})
	}
	return data({
		sentTo: recipients.length,
		file: logFileName(r.tab, r.view, "pdf"),
	})
}

export default function Log({ loaderData, actionData }: Route.ComponentProps) {
	const {
		tab,
		view,
		query,
		allColumns,
		columns,
		groups,
		totals,
		count,
		options,
		sent,
	} = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	const grouped = view.group !== "none"
	const withTab = (q: URLSearchParams) => {
		q.set("tab", tab)
		return q.toString()
	}
	const base = new URLSearchParams(query)
	const sortLink = (key: string) => {
		const q = new URLSearchParams(query)
		const same = view.sort?.key === key
		q.set("sort", key)
		q.set("dir", same && view.sort?.dir === "asc" ? "desc" : "asc")
		return `?${withTab(q)}`
	}
	const tabLink = (to: string) => `?tab=${to}`
	const exportQuery = withTab(base)
	const filterKeys = Object.keys(options)
	return (
		<div className="space-y-4 p-6">
			<h1 className="text-2xl font-bold">{t("log.title")}</h1>
			<div className="flex gap-2">
				{(["brigades", "installers"] as const).map((k) => (
					<Link
						key={k}
						to={tabLink(k)}
						className={buttonVariants({
							variant: tab === k ? "default" : "outline",
							size: "sm",
						})}
					>
						{t(`log.tab.${k}`)}
					</Link>
				))}
			</div>
			<Card>
				<CardContent className="p-4">
					<Form method="get" className="flex flex-wrap items-end gap-3 text-sm">
						<input type="hidden" name="tab" value={tab} />
						{view.sort ? (
							<>
								<input type="hidden" name="sort" value={view.sort.key} />
								<input type="hidden" name="dir" value={view.sort.dir} />
							</>
						) : null}
						<div className="space-y-1">
							<span className="block text-muted-foreground">
								{t("log.date_by")}
							</span>
							<select
								name="dateBy"
								defaultValue={view.dateBy}
								className="rounded border bg-background px-2 py-1.5"
							>
								{allColumns
									.filter((c) => c.type === "date")
									.map((c) => (
										<option key={c.key} value={c.key}>
											{t(c.labelKey as never)}
										</option>
									))}
							</select>
						</div>
						<div className="space-y-1">
							<span className="block text-muted-foreground">
								{t("log.from")}
							</span>
							<Input
								aria-label={t("log.from")}
								type="date"
								name="from"
								defaultValue={view.from ?? ""}
							/>
						</div>
						<div className="space-y-1">
							<span className="block text-muted-foreground">{t("log.to")}</span>
							<Input
								aria-label={t("log.to")}
								type="date"
								name="to"
								defaultValue={view.to ?? ""}
							/>
						</div>
						{filterKeys.map((k) => (
							<label key={k} className="space-y-1">
								<span className="block text-muted-foreground">
									{t(allColumns.find((c) => c.key === k)?.labelKey as never)}
								</span>
								<select
									name={k}
									defaultValue={view.filters[k] ?? ""}
									className="rounded border bg-background px-2 py-1.5"
								>
									<option value="">{t("log.all")}</option>
									{options[k].map((o) => (
										<option key={o} value={o}>
											{o}
										</option>
									))}
								</select>
							</label>
						))}
						<div className="space-y-1">
							<span className="block text-muted-foreground">
								{t("log.search")}
							</span>
							<Input
								name="q"
								defaultValue={view.q}
								placeholder={t("log.search_hint")}
							/>
						</div>
						<div className="space-y-1">
							<span className="block text-muted-foreground">
								{t("log.group_by")}
							</span>
							<select
								name="group"
								defaultValue={view.group}
								className="rounded border bg-background px-2 py-1.5"
							>
								<option value="none">{t("log.group_none")}</option>
								<option value="week">{t("log.group_week")}</option>
								<option value="month">{t("log.group_month")}</option>
							</select>
						</div>
						<details className="relative">
							<summary className="cursor-pointer rounded border px-2 py-1.5">
								{t("log.columns")}
							</summary>
							<div className="absolute z-10 mt-1 space-y-1 rounded border bg-card p-2 shadow">
								{allColumns.map((c) => (
									<label
										key={c.key}
										className="flex items-center gap-2 whitespace-nowrap"
									>
										<input
											type="checkbox"
											name="cols"
											value={c.key}
											defaultChecked={
												view.cols.length === 0 || view.cols.includes(c.key)
											}
										/>
										{t(c.labelKey as never)}
									</label>
								))}
							</div>
						</details>
						<Button type="submit">{t("log.apply")}</Button>
						<Link
							to={tabLink(tab)}
							className={buttonVariants({ variant: "ghost" })}
						>
							{t("log.clear")}
						</Link>
					</Form>
				</CardContent>
			</Card>
			<div className="flex flex-wrap items-center gap-2">
				<a
					href={`/comptroller/log/pdf?${exportQuery}`}
					target="_blank"
					rel="noreferrer"
					className={buttonVariants({ variant: "outline" })}
				>
					{t("log.print")}
				</a>
				<a
					href={`/comptroller/log/pdf?${exportQuery}&download=1`}
					className={buttonVariants({ variant: "outline" })}
				>
					{t("log.download_pdf")}
				</a>
				<a
					href={`/comptroller/log/xlsx?${exportQuery}`}
					className={buttonVariants({ variant: "outline" })}
				>
					{t("log.excel")}
				</a>
				<details className="relative">
					<summary
						className={`${buttonVariants({ variant: "default" })} cursor-pointer`}
					>
						{t("log.send")}
					</summary>
					<Form
						method="post"
						className="absolute z-10 mt-1 w-72 space-y-2 rounded border bg-card p-3 shadow"
					>
						<input type="hidden" name="intent" value="send_report" />
						<input type="hidden" name="qs" value={exportQuery} />
						<p className="text-sm text-muted-foreground">
							{t("log.send_hint", { count })}
						</p>
						<Input
							name="note"
							maxLength={200}
							placeholder={t("log.note")}
							aria-label={t("log.note")}
						/>
						<Button type="submit" disabled={submitting || count === 0}>
							{t("log.send_go")}
						</Button>
					</Form>
				</details>
				<span className="text-sm text-muted-foreground">
					{t("log.rows", { count })}
				</span>
			</div>
			{actionData && "errorKey" in actionData ? (
				<p className="text-sm text-status-danger">{t(actionData.errorKey)}</p>
			) : actionData && "sentTo" in actionData ? (
				<p className="text-sm text-status-ok">{t("log.sent_ok")}</p>
			) : null}
			<Card>
				<CardContent className="overflow-x-auto p-0">
					<table className="w-full text-sm">
						<thead className="border-b bg-muted text-left text-muted-foreground">
							<tr>
								{columns.map((c) => (
									<th
										key={c.key}
										className={`p-2 ${c.type === "money" ? "text-right" : ""}`}
									>
										<Link to={sortLink(c.key)} className="hover:underline">
											{t(c.labelKey as never)}
											{view.sort?.key === c.key
												? view.sort.dir === "asc"
													? " ▲"
													: " ▼"
												: ""}
										</Link>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{groups.map((g) => (
								<GroupRows
									key={g.label || "all"}
									g={g}
									columns={columns}
									grouped={grouped}
								/>
							))}
							<tr className="border-t-2 font-semibold">
								{columns.map((c, i) => (
									<td
										key={c.key}
										className={`p-2 ${c.type === "money" ? "text-right font-mono" : ""}`}
									>
										{i === 0
											? t("log.total", { count })
											: c.total
												? formatLogCell(c, totals[c.key] ?? 0)
												: ""}
									</td>
								))}
							</tr>
						</tbody>
					</table>
				</CardContent>
			</Card>
			{sent.length > 0 ? (
				<Card>
					<CardContent className="p-0">
						<h2 className="border-b p-3 text-sm font-semibold">
							{t("log.sent_heading")}
						</h2>
						<ul className="divide-y text-sm">
							{sent.map((s) => (
								<li
									key={s.id}
									className="flex flex-wrap items-center gap-3 p-3"
								>
									<span>{s.title}</span>
									<span className="text-muted-foreground">
										{t("log.sent_to", {
											name: s.to,
											date: formatShortDate(s.sentAt),
										})}
									</span>
									<span
										className={
											s.openedAt ? "text-status-ok" : "text-muted-foreground"
										}
									>
										{s.openedAt ? t("log.opened") : t("log.not_opened")}
									</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}

function GroupRows({
	g,
	columns,
	grouped,
}: {
	g: Route.ComponentProps["loaderData"]["groups"][number]
	columns: Route.ComponentProps["loaderData"]["columns"]
	grouped: boolean
}) {
	const { t } = useTranslation()
	return (
		<>
			{grouped && g.label ? (
				<tr className="bg-muted/50">
					<td colSpan={columns.length} className="p-2 font-semibold">
						{g.label}
					</td>
				</tr>
			) : null}
			{g.rows.map((r) => (
				<tr key={r.id} className="border-b last:border-0">
					{columns.map((c) => (
						<td
							key={c.key}
							className={`p-2 ${c.type === "money" ? "text-right font-mono" : ""} ${r[c.key] === MISSING ? "font-semibold text-status-warn" : ""}`}
						>
							{formatLogCell(c, r[c.key] ?? null)}
						</td>
					))}
				</tr>
			))}
			{grouped && g.label ? (
				<tr className="border-b font-medium">
					{columns.map((c, i) => (
						<td
							key={c.key}
							className={`p-2 ${c.type === "money" ? "text-right font-mono" : ""}`}
						>
							{i === 0
								? t("log.subtotal", { count: g.rows.length })
								: c.total
									? formatLogCell(c, g.totals[c.key] ?? 0)
									: ""}
						</td>
					))}
				</tr>
			) : null}
		</>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
