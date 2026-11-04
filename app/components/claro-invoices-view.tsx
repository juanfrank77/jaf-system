import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { usDate } from "~/lib/claro-invoice"
import { formatMoney } from "~/lib/utils"

export type InvoiceTabKey = "to_make" | "not_loaded" | "in_ariba"

type ToMakeRow = {
	poId: string
	poNumber: string
	avisoNumber: string | null
	total: number | null
	suggestedMonth: string | null
}

type InvoiceRow = {
	id: string
	number: string
	poNumber: string
	avisoNumber: string | null
	total: number
	madeAt: string
	loadedAt: string | null
	dueDate: string | null
}

type InvoiceCounts = {
	toMake: number
	notLoaded: number
	inAriba: number
}

type Result = { made: number; failed: number } | { marked: number } | undefined

const TABS: InvoiceTabKey[] = ["to_make", "not_loaded", "in_ariba"]

function TabLabel({ tab }: { tab: InvoiceTabKey }) {
	const { t } = useTranslation()
	return tab === "to_make"
		? t("claro_invoices.tab.to_make")
		: tab === "not_loaded"
			? t("claro_invoices.tab.not_loaded")
			: t("claro_invoices.tab.in_ariba")
}

/** W6: invoices are made from confirmed POs, loaded in Ariba by hand, then ticked here. */
export function ClaroInvoicesView({
	counts,
	tab,
	toMake,
	invoices,
	result,
	errorKey,
}: {
	counts: InvoiceCounts
	tab: InvoiceTabKey
	toMake: ToMakeRow[]
	invoices: InvoiceRow[]
	result?: Result
	errorKey?: "claro_invoices.errors.none_selected"
}) {
	const { t } = useTranslation()
	const count: Record<InvoiceTabKey, number> = {
		to_make: counts.toMake,
		not_loaded: counts.notLoaded,
		in_ariba: counts.inAriba,
	}
	return (
		<div className="space-y-3">
			<nav className="flex flex-wrap border-b">
				{TABS.map((k) => (
					<Link
						key={k}
						to={`?tab=${k}`}
						className={
							k === tab
								? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
								: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
						}
					>
						<TabLabel tab={k} /> {count[k]}
					</Link>
				))}
			</nav>
			{errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(errorKey)}
				</p>
			)}
			{result && "made" in result && (
				<p role="status" className="text-sm">
					{t("claro_invoices.made_summary", {
						made: result.made,
						failed: result.failed,
					})}
				</p>
			)}
			{result && "marked" in result && (
				<p role="status" className="text-sm">
					{t("claro_invoices.marked_summary", { count: result.marked })}
				</p>
			)}
			{tab === "to_make" ? (
				toMake.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("claro_invoices.empty_to_make")}
					</p>
				) : (
					<Form method="post" className="space-y-3">
						<input type="hidden" name="intent" value="make" />
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="p-2" />
										<th className="p-2">{t("claro_invoices.col.po")}</th>
										<th className="p-2">{t("claro_invoices.col.aviso")}</th>
										<th className="p-2 text-right">
											{t("claro_invoices.col.total")}
										</th>
										<th className="p-2">
											{t("claro_invoices.col.work_month")}
										</th>
									</tr>
								</thead>
								<tbody>
									{toMake.map((r) => (
										<tr key={r.poId} className="border-b last:border-0">
											<td className="p-2">
												<input
													type="checkbox"
													name="poId"
													value={r.poId}
													defaultChecked
													aria-label={t("claro_invoices.select_row", {
														number: r.poNumber,
													})}
												/>
											</td>
											<td className="p-2 font-mono">{r.poNumber}</td>
											<td className="p-2 font-mono">{r.avisoNumber ?? "—"}</td>
											<td className="p-2 text-right font-mono">
												{r.total === null ? "—" : formatMoney(r.total)}
											</td>
											<td className="p-2">
												<input
													type="month"
													name={`month-${r.poId}`}
													defaultValue={r.suggestedMonth ?? ""}
													required
													aria-label={t("claro_invoices.col.work_month")}
													className="rounded border px-1"
												/>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<Button type="submit">{t("claro_invoices.make")}</Button>
					</Form>
				)
			) : invoices.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{tab === "not_loaded"
						? t("claro_invoices.empty_not_loaded")
						: t("claro_invoices.empty_in_ariba")}
				</p>
			) : (
				<Form method="post" className="space-y-3">
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									{tab === "not_loaded" && <th className="p-2" />}
									<th className="p-2">{t("claro_invoices.col.invoice")}</th>
									<th className="p-2">{t("claro_invoices.col.po")}</th>
									<th className="p-2">{t("claro_invoices.col.aviso")}</th>
									<th className="p-2 text-right">
										{t("claro_invoices.col.total")}
									</th>
									<th className="p-2">{t("claro_invoices.col.made")}</th>
									<th className="p-2">{t("claro_invoices.col.loaded")}</th>
									<th className="p-2">{t("claro_invoices.col.due")}</th>
								</tr>
							</thead>
							<tbody>
								{invoices.map((r) => (
									<tr key={r.id} className="border-b last:border-0">
										{tab === "not_loaded" && (
											<td className="p-2">
												<input
													type="checkbox"
													name="id"
													value={r.id}
													aria-label={t("claro_invoices.select_row", {
														number: r.number,
													})}
												/>
											</td>
										)}
										<td className="p-2 font-mono">
											<a
												href={`/finance/awaiting-ariba/${r.id}/file`}
												className="underline"
											>
												{r.number}
											</a>
										</td>
										<td className="p-2 font-mono">{r.poNumber}</td>
										<td className="p-2 font-mono">{r.avisoNumber ?? "—"}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(r.total)}
										</td>
										<td className="p-2">{usDate(r.madeAt)}</td>
										<td className="p-2">
											{r.loadedAt ? usDate(r.loadedAt) : "—"}
										</td>
										<td className="p-2">
											{r.dueDate ? usDate(r.dueDate) : "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{tab === "not_loaded" && (
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={(e) => {
									const form = e.currentTarget.form
									if (!form) return
									const ids = Array.from(
										form.querySelectorAll<HTMLInputElement>(
											'input[name="id"]:checked',
										),
									).map((i) => i.value)
									if (ids.length === 0) return
									// A resource route, because a page action cannot return a file.
									window.location.assign(
										`/finance/awaiting-ariba/zip?${ids.map((i) => `id=${encodeURIComponent(i)}`).join("&")}`,
									)
								}}
							>
								{t("claro_invoices.download")}
							</Button>
							<Button type="submit" name="intent" value="mark_loaded">
								{t("claro_invoices.mark_loaded")}
							</Button>
						</div>
					)}
				</Form>
			)}
		</div>
	)
}
