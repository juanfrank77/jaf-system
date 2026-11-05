import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { usDate } from "~/lib/claro-invoice"
import { formatMoney } from "~/lib/utils"

export type InvoiceTabKey = "to_make" | "not_loaded" | "in_ariba"

export type InvoiceErrorKey =
	| "claro_invoices.errors.none_selected"
	| "claro_invoices.errors.no_signature"
	| "claro_invoices.errors.not_old_number"
	| "claro_invoices.errors.number_taken"
	| "claro_invoices.errors.po_not_available"
	| "claro_invoices.errors.bad_total"

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
	/** An old M19 added by hand has no PDF. */
	hasFile: boolean
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

type Result =
	| { made: number; failed: number }
	| { marked: number }
	| { addedOld: string }
	| undefined

type OldPrefill = { number: string; amount: string; po: string } | null

const TABS: InvoiceTabKey[] = ["to_make", "not_loaded", "in_ariba"]

function TabLabel({ tab }: { tab: InvoiceTabKey }) {
	const { t } = useTranslation()
	return tab === "to_make"
		? t("claro_invoices.tab.to_make")
		: tab === "not_loaded"
			? t("claro_invoices.tab.not_loaded")
			: t("claro_invoices.tab.in_ariba")
}

/** An old M19 the system doesn't have, because a PO or a payment refers to it. */
function OldInvoiceForm({ prefill }: { prefill: OldPrefill }) {
	const { t } = useTranslation()
	return (
		<details open={prefill !== null} className="rounded-lg border bg-card p-3">
			<summary className="cursor-pointer text-sm font-medium">
				{t("claro_invoices.old.heading")}
			</summary>
			<p className="mt-2 text-xs text-muted-foreground">
				{t("claro_invoices.old.description")}
			</p>
			<Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
				<input type="hidden" name="intent" value="add_old" />
				<div>
					<Label htmlFor="old-number" className="text-xs">
						{t("claro_invoices.old.number")}
					</Label>
					<Input
						id="old-number"
						name="number"
						required
						placeholder="M19-0000"
						defaultValue={prefill?.number ?? ""}
						className="h-8 w-32"
					/>
				</div>
				<div>
					<Label htmlFor="old-total" className="text-xs">
						{t("claro_invoices.old.amount")}
					</Label>
					<Input
						id="old-total"
						name="total"
						required
						inputMode="decimal"
						defaultValue={prefill?.amount ?? ""}
						className="h-8 w-28"
					/>
				</div>
				<div>
					<Label htmlFor="old-po" className="text-xs">
						{t("claro_invoices.old.po")}
					</Label>
					<Input
						id="old-po"
						name="po"
						defaultValue={prefill?.po ?? ""}
						className="h-8 w-32"
					/>
				</div>
				<div>
					<Label htmlFor="old-loadedOn" className="text-xs">
						{t("claro_invoices.old.loaded_on")}
					</Label>
					<Input
						id="old-loadedOn"
						name="loadedOn"
						type="date"
						className="h-8 w-36"
					/>
				</div>
				<Button type="submit" size="sm" variant="outline">
					{t("claro_invoices.old.add")}
				</Button>
			</Form>
		</details>
	)
}

/** W6: invoices are made from confirmed POs, loaded in Ariba by hand, then ticked here. */
export function ClaroInvoicesView({
	counts,
	tab,
	toMake,
	invoices,
	oldPrefill = null,
	result,
	errorKey,
}: {
	counts: InvoiceCounts
	tab: InvoiceTabKey
	toMake: ToMakeRow[]
	invoices: InvoiceRow[]
	oldPrefill?: OldPrefill
	result?: Result
	errorKey?: InvoiceErrorKey
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
			{result && "addedOld" in result && (
				<p role="status" className="text-sm">
					{t("claro_invoices.old.added", { number: result.addedOld })}
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
										<th className="p-2" />
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
											<td className="p-2 text-xs">
												<Link
													to={`?old=&po=${encodeURIComponent(r.poNumber)}`}
													className="underline"
												>
													{t("claro_invoices.old.link")}
												</Link>
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
											{r.hasFile ? (
												<a
													href={`/finance/awaiting-ariba/${r.id}/file`}
													className="underline"
												>
													{r.number}
												</a>
											) : (
												r.number
											)}
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
			<OldInvoiceForm prefill={oldPrefill} />
		</div>
	)
}
