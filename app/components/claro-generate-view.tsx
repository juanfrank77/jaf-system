import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { usDate, zoneOf } from "~/lib/claro-invoice"
import type { ClaroPoView } from "~/lib/claro-po-view"
import { formatMoney } from "~/lib/utils"

/**
 * Step 3, Generate: the invoice made from the PO, in Claro's Ariba format,
 * signed, to download and file. Back to Review only while it is not filed.
 */
export function ClaroGenerateView({ po }: { po: ClaroPoView }) {
	const { t } = useTranslation()
	const inv = po.invoice
	if (!inv) return null
	const base = `/finance/claro/${po.id}`
	const money: [string, number][] = [
		[t("po_inbox.field.subtotal"), inv.subtotal],
		[t("po_inbox.field.ivu4"), inv.ivu4],
		[t("po_inbox.field.ivu115"), inv.ivu115],
		[t("po_inbox.field.total"), inv.total],
	]
	return (
		<section
			aria-labelledby="claro-invoice"
			className="max-w-3xl space-y-4 rounded-lg border bg-card p-4"
		>
			<div className="space-y-1">
				<h2 id="claro-invoice" className="text-lg font-semibold">
					{t("claro.generate.title", { number: inv.number })}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t("claro.generate.format")}
				</p>
			</div>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
				<div>
					<dt className="text-xs text-muted-foreground">
						{t("po_inbox.field.po")}
					</dt>
					<dd className="font-mono">{po.poNumber}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{t("po_inbox.field.aviso")}
					</dt>
					<dd className="font-mono">{po.avisoNumber ?? "—"}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{t("claro_invoices.col.work_month")}
					</dt>
					<dd>{inv.workMonth ? zoneOf(inv.workMonth) : "—"}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{t("claro_invoices.col.made")}
					</dt>
					<dd>{usDate(inv.madeAt)}</dd>
				</div>
			</dl>
			{inv.hasFile && <Badge variant="ok">{t("claro.generate.signed")}</Badge>}
			{po.lines.length > 0 && (
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-1">{t("po_inbox.line.item")}</th>
							<th className="p-1">{t("claro.lines.description")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.amount")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.rate")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.ivu")}</th>
						</tr>
					</thead>
					<tbody>
						{po.lines.map((l, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list; lines have no id and items can repeat
							<tr key={i} className="border-b last:border-0">
								<td className="p-1">{l.item}</td>
								<td className="p-1">{l.description}</td>
								<td className="p-1 text-right font-mono">
									{formatMoney(l.amount)}
								</td>
								<td className="p-1 text-right font-mono">
									{+(l.ivuRate * 100).toFixed(3)}%
								</td>
								<td className="p-1 text-right font-mono">
									{formatMoney(l.ivu)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
				{money.map(([label, n]) => (
					<div key={label} className="contents">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="text-right font-mono">{formatMoney(n)}</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap items-center gap-2">
				{inv.hasFile && (
					<a
						href={`${base}/invoice`}
						download
						className={buttonVariants({ variant: "default" })}
					>
						{t("claro.generate.download")}
					</a>
				)}
				{!inv.loadedAt && (
					<Link
						to={`${base}?step=review`}
						className={buttonVariants({ variant: "outline" })}
					>
						{t("claro.generate.back")}
					</Link>
				)}
				<Link
					to={`${base}?step=submit`}
					className={buttonVariants({ variant: "secondary" })}
				>
					{t("claro.generate.continue")}
				</Link>
			</div>
		</section>
	)
}
