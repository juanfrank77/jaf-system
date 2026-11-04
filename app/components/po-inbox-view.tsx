import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { formatShortDate } from "~/lib/payroll-request-view"
import {
	PO_TABS,
	type PoInboxCounts,
	type PoRowView,
	type PoTab,
} from "~/lib/po-inbox-view"
import type { PoCheck } from "~/lib/po-reading"
import { formatMoney } from "~/lib/utils"

/** One literal key per check, because `t()` is typed by the locale files. */
export function useCheckText() {
	const { t } = useTranslation()
	return (c: PoCheck): string => {
		const detail = c.detail ?? ""
		switch (c.code) {
			case "lines_sum":
				return t("po_inbox.check.lines_sum", { detail })
			case "totals":
				return t("po_inbox.check.totals")
			case "ivu_line":
				return t("po_inbox.check.ivu_line", { detail })
			case "po_number_format":
				return t("po_inbox.check.po_number_format")
			case "duplicate":
				return t("po_inbox.check.duplicate")
			case "pages_missing":
				return t("po_inbox.check.pages_missing", { detail })
			case "pages_unknown":
				return t("po_inbox.check.pages_unknown")
			case "po_date_missing":
				return t("po_inbox.check.po_date_missing")
			case "terms_missing":
				return t("po_inbox.check.terms_missing")
			case "over_billed":
				return t("po_inbox.check.over_billed", { detail })
			case "unreadable":
				return t("po_inbox.check.unreadable")
		}
	}
}

const TAB_COUNT = (c: PoInboxCounts): Record<PoTab, number> => ({
	ready: c.ready,
	needs_look: c.needsLook,
	blocked: c.blocked,
	unmatched: c.unmatched,
	confirmed: c.confirmed,
})

function TabLabel({ tab }: { tab: PoTab }) {
	const { t } = useTranslation()
	switch (tab) {
		case "ready":
			return t("po_inbox.tab.ready")
		case "needs_look":
			return t("po_inbox.tab.needs_look")
		case "blocked":
			return t("po_inbox.tab.blocked")
		case "unmatched":
			return t("po_inbox.tab.unmatched")
		case "confirmed":
			return t("po_inbox.tab.confirmed")
	}
}

type PoInboxResult =
	| { errorKey?: "po_inbox.errors.not_pdf" | "po_inbox.errors.no_files" }
	| { confirmed: number; skipped: number }
	| undefined

/** W5: the day's POs after upload, sorted into what can be confirmed in one click and what needs a look. */
export function PoInboxView({
	counts,
	tab,
	rows,
	result,
}: {
	counts: PoInboxCounts
	tab: PoTab
	rows: PoRowView[]
	result?: PoInboxResult
}) {
	const { t } = useTranslation()
	const checkText = useCheckText()
	const tabCounts = TAB_COUNT(counts)
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-sm font-semibold">
					{t("po_inbox.uploaded_today", { count: counts.uploadedToday })}
				</h2>
				<div className="flex flex-wrap items-center gap-2">
					<Form
						method="post"
						encType="multipart/form-data"
						className="flex items-center gap-2"
					>
						<input type="hidden" name="intent" value="upload" />
						<input
							type="file"
							name="files"
							accept="application/pdf"
							multiple
							required
							aria-label={t("po_inbox.choose_files")}
							className="text-sm"
						/>
						<Button type="submit">{t("po_inbox.upload")}</Button>
					</Form>
					<Form method="post">
						<input type="hidden" name="intent" value="confirm_all_green" />
						<Button
							type="submit"
							variant="secondary"
							disabled={counts.ready === 0}
						>
							{t("po_inbox.confirm_all_green", { count: counts.ready })}
						</Button>
					</Form>
				</div>
			</div>
			{counts.reading > 0 && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("po_inbox.reading", { count: counts.reading })}
				</p>
			)}
			{result && "errorKey" in result && result.errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(result.errorKey)}
				</p>
			)}
			{result && "confirmed" in result && (
				<p role="status" className="text-sm">
					{t("po_inbox.confirmed_summary", {
						confirmed: result.confirmed,
						skipped: result.skipped,
					})}
				</p>
			)}
			<nav className="flex flex-wrap border-b">
				{PO_TABS.map((k) => (
					<Link
						key={k}
						to={`?tab=${k}`}
						className={
							k === tab
								? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
								: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
						}
					>
						<TabLabel tab={k} /> {tabCounts[k]}
					</Link>
				))}
			</nav>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("po_inbox.empty")}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="p-2">{t("po_inbox.col.po")}</th>
								<th className="p-2">{t("po_inbox.col.date")}</th>
								<th className="p-2">{t("po_inbox.col.aviso")}</th>
								<th className="p-2 text-right">{t("po_inbox.col.total")}</th>
								<th className="p-2">{t("po_inbox.col.checks")}</th>
								<th className="p-2" />
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id} className="border-b last:border-0">
									<td className="p-2 font-mono">{r.poNumber ?? r.fileName}</td>
									<td className="p-2">
										{r.poDate ? (
											formatShortDate(`${r.poDate}T12:00:00Z`)
										) : (
											<span className="text-status-danger">
												{t("po_inbox.missing")}
											</span>
										)}
									</td>
									<td className="p-2 font-mono">
										{r.avisoNumber ?? (
											<span className="text-muted-foreground">
												{t("po_inbox.no_aviso")}
											</span>
										)}
									</td>
									<td className="p-2 text-right font-mono">
										{r.total === null ? "—" : formatMoney(r.total)}
									</td>
									<td className="p-2">
										{r.checks.length === 0 ? (
											<Badge variant="ok">{t("po_inbox.all_passed")}</Badge>
										) : (
											<ul className="space-y-0.5">
												{r.checks.map((c) => (
													<li key={`${c.code}-${c.detail ?? ""}`}>
														{checkText(c)}
													</li>
												))}
											</ul>
										)}
									</td>
									<td className="p-2">
										<div className="flex items-center gap-2">
											<Link
												to={`/finance/awaiting-po/${r.id}`}
												className="underline"
											>
												{tab === "ready" || tab === "confirmed"
													? t("po_inbox.open")
													: tab === "unmatched"
														? t("po_inbox.link_aviso")
														: t("po_inbox.fix")}
											</Link>
											{tab === "ready" && (
												<Form method="post">
													<input
														type="hidden"
														name="intent"
														value="confirm_one"
													/>
													<input type="hidden" name="id" value={r.id} />
													<Button type="submit" size="xs">
														{t("po_inbox.confirm")}
													</Button>
												</Form>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}
