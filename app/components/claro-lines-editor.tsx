import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { cents, type PoLine, recomputeFromLines } from "~/lib/po-reading"
import { cn, formatMoney } from "~/lib/utils"

type Row = {
	key: number
	item: string
	description: string
	/** As typed. */
	amount: string
	ivuRate: number
	/** The IVU as read, kept until amount or rate is edited. */
	readIvu: number | null
}

const RATES = [0.04, 0.115]
const pct = (r: number) => `${+(r * 100).toFixed(3)}%`

const ivuOf = (r: Row) =>
	r.readIvu ?? cents((Number(r.amount) || 0) * r.ivuRate) / 100

/**
 * The PO's lines, each one editable, with lines added or deleted in place.
 * Posts them as JSON in `lines`; the server works out each edited line's IVU
 * and rebuilds subtotal, IVU and total. The footer shows that rebuild live.
 */
export function ClaroLinesEditor({
	lines,
	readOnly,
	invalid,
	onEdit,
}: {
	lines: PoLine[]
	readOnly: boolean
	invalid: boolean
	onEdit: () => void
}) {
	const { t } = useTranslation()
	const [rows, setRows] = useState<Row[]>(() =>
		lines.map((l, i) => ({
			key: i,
			item: l.item,
			description: l.description,
			amount: String(l.amount),
			ivuRate: l.ivuRate,
			readIvu: l.ivu,
		})),
	)
	const [nextKey, setNextKey] = useState(lines.length)
	const edit = (key: number, patch: Partial<Row>) => {
		setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
		onEdit()
	}
	const add = () => {
		const items = rows.map((r) => Number(r.item)).filter(Number.isFinite)
		const item = items.length > 0 ? String(Math.max(...items) + 10) : "10"
		setRows((rs) => [
			...rs,
			{
				key: nextKey,
				item,
				description: "",
				amount: "",
				ivuRate: 0.115,
				readIvu: null,
			},
		])
		setNextKey((k) => k + 1)
		onEdit()
	}
	const remove = (key: number) => {
		setRows((rs) => rs.filter((r) => r.key !== key))
		onEdit()
	}
	const totals = recomputeFromLines(
		rows.map((r) => ({
			item: r.item,
			description: r.description,
			amount: Number(r.amount) || 0,
			ivuRate: r.ivuRate,
			ivu: ivuOf(r),
		})),
	)
	const posted = JSON.stringify(
		rows.map((r) => ({
			item: r.item,
			description: r.description,
			amount: r.amount.trim() === "" ? null : Number(r.amount),
			ivuRate: r.ivuRate,
		})),
	)
	return (
		<div className="space-y-2">
			<input type="hidden" name="lines" value={posted} />
			<div
				className={cn(
					"overflow-x-auto rounded-lg border",
					invalid && "border-status-danger",
				)}
			>
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-1">{t("po_inbox.line.item")}</th>
							<th className="p-1">{t("claro.lines.description")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.amount")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.rate")}</th>
							<th className="p-1 text-right">{t("po_inbox.line.ivu")}</th>
							{!readOnly && (
								<th className="p-1">
									<span className="sr-only">{t("claro.lines.actions")}</span>
								</th>
							)}
						</tr>
					</thead>
					<tbody>
						{rows.map((r, i) => {
							const n = i + 1
							const rates = RATES.includes(r.ivuRate)
								? RATES
								: [...RATES, r.ivuRate]
							return (
								<tr key={r.key} className="border-b align-top last:border-0">
									<td className="w-20 p-1">
										<Input
											aria-label={t("claro.lines.item_n", { n })}
											value={r.item}
											disabled={readOnly}
											onChange={(e) => edit(r.key, { item: e.target.value })}
										/>
									</td>
									<td className="min-w-40 p-1">
										<Input
											aria-label={t("claro.lines.description_n", { n })}
											value={r.description}
											disabled={readOnly}
											onChange={(e) =>
												edit(r.key, { description: e.target.value })
											}
										/>
									</td>
									<td className="w-28 p-1">
										<Input
											aria-label={t("claro.lines.amount_n", { n })}
											type="number"
											step="0.01"
											required
											className="text-right font-mono"
											value={r.amount}
											disabled={readOnly}
											onChange={(e) =>
												edit(r.key, { amount: e.target.value, readIvu: null })
											}
										/>
									</td>
									<td className="w-24 p-1">
										<select
											aria-label={t("claro.lines.rate_n", { n })}
											className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm disabled:opacity-50"
											value={String(r.ivuRate)}
											disabled={readOnly}
											onChange={(e) =>
												edit(r.key, {
													ivuRate: Number(e.target.value),
													readIvu: null,
												})
											}
										>
											{rates.map((rate) => (
												<option key={rate} value={String(rate)}>
													{pct(rate)}
												</option>
											))}
										</select>
									</td>
									<td className="w-24 p-1 pt-3 text-right font-mono">
										{formatMoney(ivuOf(r))}
									</td>
									{!readOnly && (
										<td className="w-10 p-1">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label={t("claro.lines.delete_n", { n })}
												onClick={() => remove(r.key)}
											>
												×
											</Button>
										</td>
									)}
								</tr>
							)
						})}
						{rows.length === 0 && (
							<tr>
								<td colSpan={6} className="p-2 text-muted-foreground">
									{t("claro.lines.none")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				{!readOnly && (
					<Button type="button" variant="outline" size="sm" onClick={add}>
						{t("claro.lines.add")}
					</Button>
				)}
				<p className="text-xs text-muted-foreground" data-testid="lines-total">
					{t("claro.lines.from_lines", {
						subtotal: formatMoney(totals.subtotal),
						ivu: formatMoney(totals.ivu4 + totals.ivu115),
						total: formatMoney(totals.total),
					})}
				</p>
			</div>
		</div>
	)
}
