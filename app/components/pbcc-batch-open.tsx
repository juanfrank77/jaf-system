import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import type { BatchSummary, BatchView } from "~/lib/pbcc-batch-view"
import { formatMoney } from "~/lib/utils"

type ActionResult = { errorKey?: string; list?: string } | undefined

function Tabs({ tab }: { tab: "open" | "sent" }) {
	const { t } = useTranslation()
	const cls = (active: boolean) =>
		active
			? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
			: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
	return (
		<nav className="flex border-b">
			<Link to="?tab=open" className={cls(tab === "open")}>
				{t("pbcc_batch.tab.open")}
			</Link>
			<Link to="?tab=sent" className={cls(tab === "sent")}>
				{t("pbcc_batch.tab.sent")}
			</Link>
		</nav>
	)
}

function Mark({ ok }: { ok: boolean }) {
	return ok ? (
		<span className="text-status-ok" role="img" aria-label="ok">
			✓
		</span>
	) : (
		<Badge variant="warn">—</Badge>
	)
}

/** W2: the one open batch, filling itself as packets are accepted. */
export function PbccBatchOpenView({
	batch,
	action,
}: {
	batch: BatchView
	action?: ActionResult
}) {
	const { t } = useTranslation()
	const error = action?.errorKey
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">
					{t("pbcc_batch.open_heading", { number: batch.number })}
				</h2>
				<Form method="post">
					<input type="hidden" name="intent" value="close_batch" />
					<input type="hidden" name="batchId" value={batch.id} />
					<Button type="submit" disabled={batch.count === 0}>
						{t("pbcc_batch.close")}
					</Button>
				</Form>
			</div>
			<p className="text-sm">
				{t("pbcc_batch.summary", {
					count: batch.count,
					max: batch.capacity,
					subtotal: formatMoney(batch.subtotal),
					percent: +(batch.advanceRate * 100).toFixed(2),
					advance: formatMoney(batch.advance),
				})}
			</p>
			<p className="text-xs text-muted-foreground">
				{t("pbcc_batch.summary_note")}
			</p>
			{error && (
				<p role="alert" className="text-sm text-status-danger">
					{t(error as never, { list: action?.list })}
				</p>
			)}
			{batch.rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("pbcc_batch.empty")}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="p-2">{t("pbcc_batch.col.row")}</th>
								<th className="p-2">{t("pbcc_batch.col.work_order")}</th>
								<th className="p-2">{t("pbcc_batch.col.aviso")}</th>
								<th className="p-2">{t("pbcc_batch.col.brigade")}</th>
								<th className="p-2">{t("pbcc_batch.col.invoice")}</th>
								<th className="p-2 text-right">
									{t("pbcc_batch.col.subtotal")}
								</th>
								<th className="p-2 text-right">{t("pbcc_batch.col.ivu")}</th>
								<th className="p-2 text-right">{t("pbcc_batch.col.total")}</th>
								<th className="p-2">{t("pbcc_batch.col.aviso_pdf")}</th>
								<th className="p-2">{t("pbcc_batch.col.invoice_pdf")}</th>
								<th className="p-2" />
							</tr>
						</thead>
						<tbody>
							{batch.rows.map((r) => (
								<tr key={r.id} className="border-b last:border-0">
									<td className="p-2 font-mono">
										{String(r.row).padStart(3, "0")}
									</td>
									<td className="p-2 font-mono">{r.controlNumber}</td>
									<td className="p-2">{r.avisoNumber ?? "—"}</td>
									<td className="p-2">{r.brigade ?? "—"}</td>
									<td className="p-2 font-mono">{r.invoiceNumber}</td>
									<td className="p-2 text-right font-mono">
										{formatMoney(r.subtotal)}
									</td>
									<td className="p-2 text-right font-mono">
										{formatMoney(r.ivu)}
									</td>
									<td className="p-2 text-right font-mono">
										{formatMoney(r.total)}
									</td>
									<td className="p-2">
										<Mark ok={r.hasAvisoPdf} />
									</td>
									<td className="p-2">
										<Mark ok={r.hasInvoicePdf} />
									</td>
									<td className="p-2">
										<Form method="post" className="flex items-center gap-1">
											<input type="hidden" name="intent" value="take_out" />
											<input type="hidden" name="docId" value={r.id} />
											<Input
												name="reason"
												required
												aria-label={`${t("pbcc_batch.reason")} ${r.controlNumber}`}
												placeholder={t("pbcc_batch.reason")}
												className="h-8 w-32"
											/>
											<Button type="submit" variant="outline" size="sm">
												{t("pbcc_batch.take_out")}
											</Button>
										</Form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				{t("pbcc_batch.take_out_note")}
			</p>
		</div>
	)
}

/** The Sent tab: closed batches waiting to be sent, then the ones already sent. */
export function PbccBatchListView({
	batches,
	openBatch,
}: {
	batches: BatchSummary[]
	openBatch: { id: string; number: number }
}) {
	const { t, i18n } = useTranslation()
	const date = (iso: string) =>
		new Date(iso).toLocaleDateString(i18n.language, {
			timeZone: "America/Puerto_Rico",
		})
	return (
		<div className="space-y-2">
			<p className="text-sm">
				<Link to="?tab=open" className="underline">
					{t("pbcc_batch.open_batch")} #{openBatch.number}
				</Link>
			</p>
			{batches.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("pbcc_batch.none_sent")}
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card text-sm">
					{batches.map((b) => (
						<li
							key={b.id}
							className="flex flex-wrap items-center justify-between gap-2 p-3"
						>
							<Link
								to={`/finance/schedules/${b.id}`}
								className="font-medium underline"
							>
								#{b.number}
							</Link>
							<span className="text-muted-foreground">
								{t("pbcc_batch.packets", { count: b.count })} ·{" "}
								{formatMoney(b.subtotal)}
							</span>
							<Badge variant={b.status === "sent" ? "ok" : "warn"}>
								{b.status === "sent" && b.sentAt
									? t("pbcc_batch.status.sent", { date: date(b.sentAt) })
									: t("pbcc_batch.status.closed")}
							</Badge>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

export { Tabs as PbccBatchTabs }
