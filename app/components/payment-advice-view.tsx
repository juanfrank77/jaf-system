import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { usDate } from "~/lib/claro-invoice"
import { formatMoney } from "~/lib/utils"

export type AdviceTabKey = "upload" | "applied" | "unmatched"
const TABS: AdviceTabKey[] = ["upload", "applied", "unmatched"]

type AdviceLineView = {
	id: string
	invoiceRef: string
	voucher: string | null
	invoiceDate: string | null
	net: number
	ourTotal: number | null
	result: "MATCHED" | "SHORT" | "UNMATCHED" | "ALREADY_PAID"
	otherJaf: boolean
	invoiceId: string | null
	needsAccept: boolean
}

type AdviceCardView = {
	id: string
	adviceDate: string
	bank: string | null
	reference: string | null
	total: number
	rowsTotal: number
	totalOk: boolean
	applied: boolean
	lines: AdviceLineView[]
}

type UnmatchedView = {
	id: string
	invoiceRef: string
	voucher: string | null
	net: number
	adviceDate: string
	reference: string | null
}

type OtherJafView = { total: number; lines: UnmatchedView[] }

type AdviceCounts = { pending: number; applied: number; unmatched: number }

export type AdviceErrorKey =
	| "payment_advice.errors.not_pdf"
	| "payment_advice.errors.unreadable"
	| "payment_advice.errors.date_missing"
	| "payment_advice.errors.duplicate"
	| "payment_advice.errors.total_mismatch"
	| "payment_advice.errors.already_applied"
	| "payment_advice.errors.not_found"
	| "payment_advice.errors.not_short"
	| "payment_advice.errors.reason_required"
	| "payment_advice.errors.invoice_not_found"
	| "payment_advice.errors.line_not_unmatched"
	| "payment_advice.errors.no_file"

function ResultBadge({ line }: { line: AdviceLineView }) {
	const { t } = useTranslation()
	if (line.result === "MATCHED")
		return <Badge variant="ok">{t("payment_advice.result.matched")}</Badge>
	if (line.result === "SHORT")
		return (
			<Badge variant="warn">
				{t("payment_advice.result.short", {
					diff: formatMoney((line.ourTotal ?? 0) - line.net),
				})}
			</Badge>
		)
	if (line.result === "ALREADY_PAID")
		return (
			<Badge variant="warn">{t("payment_advice.result.already_paid")}</Badge>
		)
	if (line.otherJaf)
		return <Badge>{t("payment_advice.result.other_jaf")}</Badge>
	return <Badge variant="danger">{t("payment_advice.result.unmatched")}</Badge>
}

function LinkForm({ lineId }: { lineId: string }) {
	const { t } = useTranslation()
	return (
		<Form method="post" className="flex items-center gap-1">
			<input type="hidden" name="intent" value="link" />
			<input type="hidden" name="lineId" value={lineId} />
			<Input
				name="invoice"
				required
				placeholder="M19-0000"
				aria-label={t("payment_advice.invoice_number")}
				className="h-7 w-28"
			/>
			<Button type="submit" size="xs" variant="outline">
				{t("payment_advice.link")}
			</Button>
		</Form>
	)
}

function AdviceCard({ a }: { a: AdviceCardView }) {
	const { t } = useTranslation()
	const matched = a.lines.filter((l) => l.result === "MATCHED").length
	const short = a.lines.filter((l) => l.result === "SHORT").length
	const unmatched = a.lines.filter(
		(l) => l.result === "UNMATCHED" && !l.otherJaf,
	).length
	const otherJaf = a.lines.filter((l) => l.otherJaf)
	const already = a.lines.filter((l) => l.result === "ALREADY_PAID").length
	return (
		<section className="space-y-2 rounded-lg border bg-card p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					{t("payment_advice.card_title", {
						date: usDate(a.adviceDate),
						ref: a.reference ?? "—",
						count: a.lines.length,
						total: formatMoney(a.total),
					})}{" "}
					{a.totalOk ? (
						<Badge variant="ok">{t("payment_advice.total_ok")}</Badge>
					) : (
						<Badge variant="danger">
							{t("payment_advice.total_off", {
								rows: formatMoney(a.rowsTotal),
							})}
						</Badge>
					)}
				</h3>
				<Link
					to={`/finance/payment-advice/${a.id}/file`}
					className="text-sm underline"
				>
					{t("payment_advice.open_pdf")}
				</Link>
			</div>
			<p className="text-sm text-muted-foreground">
				{t("payment_advice.summary", { matched, short, unmatched, already })}
				{otherJaf.length > 0 &&
					` · ${t("payment_advice.other_jaf_summary", {
						count: otherJaf.length,
						total: formatMoney(otherJaf.reduce((s, l) => s + l.net, 0)),
					})}`}
			</p>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-2">{t("payment_advice.col.invoice")}</th>
							<th className="p-2">{t("payment_advice.col.voucher")}</th>
							<th className="p-2">{t("payment_advice.col.invoice_date")}</th>
							<th className="p-2 text-right">{t("payment_advice.col.net")}</th>
							<th className="p-2 text-right">{t("payment_advice.col.ours")}</th>
							<th className="p-2">{t("payment_advice.col.result")}</th>
							<th className="p-2" />
						</tr>
					</thead>
					<tbody>
						{a.lines.map((l) => (
							<tr key={l.id} className="border-b last:border-0">
								<td className="p-2 font-mono">{l.invoiceRef}</td>
								<td className="p-2 font-mono">{l.voucher ?? "—"}</td>
								<td className="p-2">
									{l.invoiceDate ? usDate(l.invoiceDate) : "—"}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.net)}
								</td>
								<td className="p-2 text-right font-mono">
									{l.ourTotal === null ? "—" : formatMoney(l.ourTotal)}
								</td>
								<td className="p-2">
									<ResultBadge line={l} />
								</td>
								<td className="p-2">
									{l.result === "UNMATCHED" && !l.otherJaf && (
										<LinkForm lineId={l.id} />
									)}
									{l.needsAccept && l.invoiceId && (
										<Form method="post" className="flex items-center gap-1">
											<input type="hidden" name="intent" value="accept_short" />
											<input
												type="hidden"
												name="invoiceId"
												value={l.invoiceId}
											/>
											<Input
												name="reason"
												required
												placeholder={t("payment_advice.reason")}
												aria-label={t("payment_advice.reason")}
												className="h-7 w-40"
											/>
											<Button type="submit" size="xs" variant="outline">
												{t("payment_advice.accept_short")}
											</Button>
										</Form>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{!a.applied && (
				<Form method="post">
					<input type="hidden" name="intent" value="apply" />
					<input type="hidden" name="adviceId" value={a.id} />
					<Button type="submit" disabled={!a.totalOk}>
						{t("payment_advice.apply")}
					</Button>
					<span className="ml-2 text-xs text-muted-foreground">
						{t("payment_advice.unmatched_kept")}
					</span>
				</Form>
			)}
		</section>
	)
}

function TabLabel({ tab }: { tab: AdviceTabKey }) {
	const { t } = useTranslation()
	return tab === "upload"
		? t("payment_advice.tab.upload")
		: tab === "applied"
			? t("payment_advice.tab.applied")
			: t("payment_advice.tab.unmatched")
}

/** W7: upload Claro's advice, review the match results, apply the payments. */
export function PaymentAdviceView({
	counts,
	tab,
	advices,
	unmatched,
	otherJaf,
	errorKey,
}: {
	counts: AdviceCounts
	tab: AdviceTabKey
	advices: AdviceCardView[]
	unmatched: UnmatchedView[]
	otherJaf: OtherJafView
	errorKey?: AdviceErrorKey
}) {
	const { t } = useTranslation()
	const count: Record<AdviceTabKey, number> = {
		upload: counts.pending,
		applied: counts.applied,
		unmatched: counts.unmatched,
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
			{tab === "upload" && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="flex flex-wrap items-center gap-2"
				>
					<input type="hidden" name="intent" value="upload" />
					<input
						type="file"
						name="file"
						accept="application/pdf"
						required
						aria-label={t("payment_advice.choose_file")}
						className="text-sm"
					/>
					<Button type="submit">{t("payment_advice.upload")}</Button>
				</Form>
			)}
			{tab === "unmatched" && otherJaf.lines.length > 0 && (
				<section className="space-y-2 rounded-lg border bg-card p-3">
					<h3 className="text-sm font-semibold">
						{t("payment_advice.other_jaf_title")} ·{" "}
						{formatMoney(otherJaf.total)}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t("payment_advice.other_jaf_body", {
							count: otherJaf.lines.length,
						})}
					</p>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<tbody>
								{otherJaf.lines.map((u) => (
									<tr key={u.id} className="border-b last:border-0">
										<td className="p-2 font-mono">{u.invoiceRef}</td>
										<td className="p-2 font-mono">{u.voucher ?? "—"}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(u.net)}
										</td>
										<td className="p-2">
											{usDate(u.adviceDate)} · {u.reference ?? "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}
			{tab === "unmatched" ? (
				unmatched.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("payment_advice.empty_unmatched")}
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="p-2">{t("payment_advice.col.invoice")}</th>
									<th className="p-2">{t("payment_advice.col.voucher")}</th>
									<th className="p-2 text-right">
										{t("payment_advice.col.net")}
									</th>
									<th className="p-2">{t("payment_advice.col.advice")}</th>
									<th className="p-2" />
								</tr>
							</thead>
							<tbody>
								{unmatched.map((u) => (
									<tr key={u.id} className="border-b last:border-0">
										<td className="p-2 font-mono">{u.invoiceRef}</td>
										<td className="p-2 font-mono">{u.voucher ?? "—"}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(u.net)}
										</td>
										<td className="p-2">
											{usDate(u.adviceDate)} · {u.reference ?? "—"}
										</td>
										<td className="p-2">
											<LinkForm lineId={u.id} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)
			) : advices.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{tab === "upload"
						? t("payment_advice.empty_upload")
						: t("payment_advice.empty_applied")}
				</p>
			) : (
				<div className="space-y-3">
					{advices.map((a) => (
						<AdviceCard key={a.id} a={a} />
					))}
				</div>
			)}
		</div>
	)
}
