import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { usDate } from "~/lib/claro-invoice"
import { formatMoney } from "~/lib/utils"

export type ClaroCloseError =
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
	| "payment_advice.errors.not_ja_line"
	| "payment_advice.errors.no_file"

type Line = {
	id: string
	invoiceRef: string
	voucher: string | null
	net: number
	ourTotal: number | null
	result: "MATCHED" | "SHORT" | "UNMATCHED" | "ALREADY_PAID"
	invoiceId: string | null
	needsAccept: boolean
}
type Advice = {
	id: string
	adviceDate: string
	reference: string | null
	total: number
	totalOk: boolean
	rowsTotal: number
	lines: Line[]
}

function ResultBadge({ line }: { line: Line }) {
	const { t } = useTranslation()
	if (line.result === "MATCHED")
		return <Badge variant="ok">{t("claro.close.result.close")}</Badge>
	if (line.result === "SHORT")
		return (
			<Badge variant="warn">
				{t("claro.close.result.short", {
					diff: formatMoney((line.ourTotal ?? 0) - line.net),
				})}
			</Badge>
		)
	if (line.result === "ALREADY_PAID")
		return <Badge variant="warn">{t("claro.close.result.already_paid")}</Badge>
	return <Badge variant="danger">{t("claro.close.result.unmatched")}</Badge>
}

function AcceptShort({ line }: { line: Line }) {
	const { t } = useTranslation()
	return (
		<Form method="post" className="flex items-center gap-1">
			<input type="hidden" name="intent" value="accept_short" />
			<input type="hidden" name="invoiceId" value={line.invoiceId ?? ""} />
			<Input
				name="reason"
				required
				placeholder={t("claro.close.reason")}
				aria-label={t("claro.close.reason")}
				className="h-7 w-40"
			/>
			<Button type="submit" size="xs" variant="outline">
				{t("claro.close.accept_short")}
			</Button>
		</Form>
	)
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
				placeholder="M20-000"
				aria-label={t("claro.close.invoice_number")}
				className="h-7 w-28"
			/>
			<Button type="submit" size="xs" variant="outline">
				{t("claro.close.link")}
			</Button>
		</Form>
	)
}

function StatementCard({ a, fresh }: { a: Advice; fresh: boolean }) {
	const { t } = useTranslation()
	const closing = a.lines.filter(
		(l) => l.result === "MATCHED" || l.result === "SHORT",
	).length
	return (
		<section
			className={`space-y-2 rounded-lg border bg-card p-3 ${fresh ? "ring-2 ring-primary" : ""}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">
					{t("claro.close.statement_title", {
						date: usDate(a.adviceDate),
						ref: a.reference ?? "—",
						total: formatMoney(a.total),
					})}
				</h2>
				<Link
					to={`/finance/payment-advice/${a.id}/file`}
					className="text-sm underline"
				>
					{t("claro.close.open_pdf")}
				</Link>
			</div>
			{!a.totalOk && (
				<p role="alert" className="text-sm text-status-danger">
					{t("payment_advice.total_off", { rows: formatMoney(a.rowsTotal) })}
				</p>
			)}
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-2">{t("claro.close.col.line")}</th>
							<th className="p-2">{t("claro.close.col.matched")}</th>
							<th className="p-2 text-right">{t("claro.close.col.amount")}</th>
							<th className="p-2">{t("claro.close.col.result")}</th>
							<th className="p-2" />
						</tr>
					</thead>
					<tbody>
						{a.lines.map((l) => (
							<tr key={l.id} className="border-b last:border-0">
								<td className="p-2 font-mono">
									{l.invoiceRef}
									{l.voucher ? ` · ${l.voucher}` : ""}
								</td>
								<td className="p-2 font-mono">
									{l.result === "UNMATCHED" ? "—" : l.invoiceRef}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.net)}
								</td>
								<td className="p-2">
									<ResultBadge line={l} />
								</td>
								<td className="p-2">
									{l.result === "UNMATCHED" && <LinkForm lineId={l.id} />}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<Form method="post" className="flex flex-wrap items-center gap-2">
				<input type="hidden" name="intent" value="apply" />
				<input type="hidden" name="adviceId" value={a.id} />
				<Button type="submit" disabled={!a.totalOk}>
					{closing === 0
						? t("claro.close.mark_reviewed")
						: t("claro.close.apply")}
				</Button>
				<span className="text-xs text-muted-foreground">
					{t("claro.close.apply_hint")}
				</span>
			</Form>
		</section>
	)
}

/** Step 5: drop Claro's payment statement, read it, close the matched files. */
export function ClaroCloseView({
	advices,
	unmatched,
	shorts,
	errorKey,
	readId,
}: {
	advices: Advice[]
	unmatched: {
		id: string
		invoiceRef: string
		net: number
		adviceDate: string
	}[]
	shorts: (Line & { adviceDate: string })[]
	errorKey?: ClaroCloseError
	readId?: string
}) {
	const { t } = useTranslation()
	// Unmatched rows of a pending statement are already in its table.
	const shown = new Set(advices.flatMap((a) => a.lines.map((l) => l.id)))
	const others = unmatched.filter((u) => !shown.has(u.id))
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">{t("claro.close.intro")}</p>
			{errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(errorKey)}
				</p>
			)}
			<Form
				method="post"
				encType="multipart/form-data"
				className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-card p-4"
			>
				<input type="hidden" name="intent" value="upload" />
				<input
					type="file"
					name="file"
					accept="application/pdf"
					required
					aria-label={t("claro.close.choose_file")}
					className="text-sm"
				/>
				<Button type="submit">{t("claro.close.read")}</Button>
			</Form>
			{advices.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("claro.close.empty")}
				</p>
			) : (
				advices.map((a) => (
					<StatementCard key={a.id} a={a} fresh={a.id === readId} />
				))
			)}
			{shorts.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-semibold">{t("claro.close.shorts")}</h2>
					<p className="text-xs text-muted-foreground">
						{t("claro.close.shorts_hint")}
					</p>
					<ul className="space-y-2">
						{shorts.map((l) => (
							<li
								key={l.id}
								className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2 text-sm"
							>
								<span className="font-mono">{l.invoiceRef}</span>
								<span className="font-mono">{formatMoney(l.net)}</span>
								<ResultBadge line={l} />
								<AcceptShort line={l} />
							</li>
						))}
					</ul>
				</section>
			)}
			{others.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-semibold">
						{t("claro.close.unmatched")}
					</h2>
					<ul className="space-y-2">
						{others.map((u) => (
							<li
								key={u.id}
								className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2 text-sm"
							>
								<span className="font-mono">{u.invoiceRef}</span>
								<span className="font-mono">{formatMoney(u.net)}</span>
								<span className="text-xs text-muted-foreground">
									{usDate(u.adviceDate)}
								</span>
								<LinkForm lineId={u.id} />
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	)
}
