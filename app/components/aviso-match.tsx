import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import { Textarea } from "~/components/ui/textarea"
import {
	type AvisoLine,
	type InvoiceLine,
	type PreCertLine,
	round2,
	type ServiceLine,
	sumLines,
} from "~/lib/service-lines"
import { checkAvisoMatch } from "~/lib/supervisor-stage"
import { cn, formatMoney } from "~/lib/utils"

type AvisoRow = {
	serviceCodeId: string
	claroCode: string
	qty: number
	unitPrice: number
}

type AvisoError = {
	errorKey?: string
	errorMessage?: string
} | null

type Props = {
	docId: string
	avisoNumber: string | null
	avisoDocPath: string | null
	storedLines: AvisoLine[]
	locked: boolean
	invoiceLines: InvoiceLine[]
	ordered: ServiceLine[]
	certified: PreCertLine[] | undefined
	/** serviceCodeId → current catalog unit price, to price the ordered column. */
	catalogPrices: Record<string, number>
	tolerance: number
	error: AvisoError
	readOnly: boolean
	/** An Aviso number or lines were already saved. */
	started: boolean
	/** Extra controls rendered under the form (e.g. the optional Claro PDF). */
	children?: React.ReactNode
}

type MatchState = "ok" | "qty" | "amt"

const STATE_ICON = { ok: "✓", qty: "⚠", amt: "✕" } as const
const STATE_VARIANT = { ok: "ok", qty: "warn", amt: "danger" } as const

export function AvisoMatchCard({
	docId,
	avisoNumber,
	avisoDocPath,
	storedLines,
	locked,
	invoiceLines,
	ordered,
	certified,
	catalogPrices,
	tolerance,
	error,
	readOnly,
	started,
	children,
}: Props) {
	const { t } = useTranslation()
	const [touched, setTouched] = useState(false)
	const [pickedFile, setPickedFile] = useState<string | null>(null)
	const [rows, setRows] = useState<AvisoRow[]>(() =>
		invoiceLines.map((l) => {
			const stored = storedLines.find(
				(s) => s.serviceCodeId === l.serviceCodeId,
			)
			return {
				serviceCodeId: l.serviceCodeId,
				claroCode: l.claroCode,
				qty: stored?.qty ?? l.qty,
				unitPrice: stored?.unitPrice ?? l.unitPrice,
			}
		}),
	)

	// Same arithmetic as the save_aviso action: zero-qty rows are dropped and
	// each line is round2(qty × unit price).
	const charged: AvisoLine[] = rows
		.filter((r) => r.qty > 0)
		.map((r) => ({
			...r,
			lineAmount: round2(r.qty * r.unitPrice),
		}))
	const match = checkAvisoMatch(invoiceLines, charged, tolerance)
	const state: MatchState = !match.amountOk
		? "amt"
		: match.lineMismatches.length > 0
			? "qty"
			: "ok"
	// Nothing has been entered yet: do not claim the Aviso "agrees".
	const active = started || touched

	const orderedTotal = sumLines(
		ordered.map((o) => ({
			lineAmount: round2(
				o.qty *
					(catalogPrices[o.serviceCodeId] ??
						invoiceLines.find((l) => l.serviceCodeId === o.serviceCodeId)
							?.unitPrice ??
						0),
			),
		})),
	)
	const description = (id: string) =>
		invoiceLines.find((l) => l.serviceCodeId === id)?.name
	const fileName = pickedFile ?? avisoDocPath?.split(/[\\/]/).pop() ?? null
	const update = (i: number, patch: Partial<AvisoRow>) => {
		setTouched(true)
		setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
	}

	const alertKey = {
		ok: "docs_review_steps.alert_ok",
		qty: "docs_review_steps.alert_qty",
		amt: "docs_review_steps.alert_amt",
	}[state]

	return (
		<Card>
			<CardHeader className="items-start">
				<div>
					<div className="text-base font-bold">
						{t("docs_review_steps.aviso_heading")}
					</div>
					<p className="mt-0.5 text-xs font-normal text-muted-foreground">
						{t("docs_review_steps.aviso_hint")}
					</p>
				</div>
			</CardHeader>
			<CardContent>
				<Form method="post" encType="multipart/form-data" className="space-y-4">
					<fieldset disabled={readOnly} className="min-w-0 space-y-4">
						<input type="hidden" name="intent" value="save_aviso" />
						<div className="grid gap-3 sm:grid-cols-2">
							<div>
								<Label htmlFor="avisoNumber" className="text-xs">
									{t("docs_review.aviso_number")}{" "}
									<span className="font-normal text-muted-foreground">
										{t("docs_review_steps.aviso_number_hint")}
									</span>
								</Label>
								<Input
									id="avisoNumber"
									name="avisoNumber"
									defaultValue={avisoNumber ?? ""}
									className="mt-1 font-mono"
								/>
							</div>
							<div>
								<Label htmlFor="avisoPdf" className="text-xs">
									{t("docs_review_steps.aviso_pdf_label")}
								</Label>
								<div className="mt-1 flex min-h-9 items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm">
									<span aria-hidden="true">📎</span>
									{fileName ? (
										pickedFile || !avisoDocPath ? (
											<span className="truncate">{fileName}</span>
										) : (
											<a
												href={`/files/aviso-docs/${docId}-aviso.pdf`}
												className="truncate text-accent-text underline"
											>
												{fileName}
											</a>
										)
									) : (
										<span className="text-muted-foreground">
											{t("docs_review_steps.aviso_doc_empty")}
										</span>
									)}
									<span className="ml-auto shrink-0 text-xs font-semibold text-status-ok">
										{avisoDocPath && !pickedFile
											? `${t("docs_review_steps.lines_captured", { count: storedLines.length })} · `
											: ""}
										{!readOnly && (
											<label
												htmlFor="avisoPdf"
												className="cursor-pointer underline"
											>
												{avisoDocPath
													? t("docs_review_steps.replace")
													: t("docs_review_steps.choose_file")}
											</label>
										)}
									</span>
									<input
										id="avisoPdf"
										type="file"
										name="avisoPdf"
										accept="application/pdf"
										className="sr-only"
										onChange={(e) =>
											setPickedFile(e.target.files?.[0]?.name ?? null)
										}
									/>
								</div>
							</div>
						</div>

						{active && (
							<Pill variant={STATE_VARIANT[state]} icon={STATE_ICON[state]}>
								<b>
									{t(`${alertKey}_title` as ParseKeys, {
										count: match.lineMismatches.length,
									})}
								</b>{" "}
								{t(`${alertKey}_body` as ParseKeys, {
									aviso: formatMoney(match.avisoTotal),
									invoice: formatMoney(match.invoiceTotal),
								})}
							</Pill>
						)}

						<div className="grid gap-3 sm:grid-cols-3">
							<Total
								label={t("docs_review_steps.total_ordered")}
								value={formatMoney(orderedTotal)}
								sub={t("docs_review_steps.total_ordered_sub")}
							/>
							<Total
								label={t("docs_review_steps.total_installed")}
								value={formatMoney(match.invoiceTotal)}
								sub={t("docs_review_steps.total_installed_sub")}
							/>
							<Total
								label={t("docs_review_steps.total_charged")}
								value={formatMoney(match.avisoTotal)}
								sub={t(
									active
										? (`docs_review_steps.total_charged_sub_${state}` as ParseKeys)
										: "docs_review_steps.total_charged_sub_pending",
									{ count: match.lineMismatches.length },
								)}
								bad={active && state !== "ok"}
							/>
						</div>

						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="py-1.5">{t("docs_review.table.code")}</th>
									<th className="py-1.5">
										{t("docs_review.table.description")}
									</th>
									<th className="py-1.5 text-right">
										{t("docs_review_steps.col_ordered")}
									</th>
									<th className="py-1.5 text-right">
										{t("docs_review_steps.col_installed")}
									</th>
									<th className="py-1.5 text-right">
										{t("docs_review_steps.col_certified")}
									</th>
									<th className="py-1.5 text-right">
										{t("docs_review_steps.col_charged")}
									</th>
									<th className="py-1.5 text-right">
										{t("docs_review_steps.aviso_unit_price")}
									</th>
									<th className="py-1.5">
										{t("docs_review_steps.col_status")}
									</th>
								</tr>
							</thead>
							<tbody className="tabular-nums">
								{rows.map((r, i) => {
									const inv = invoiceLines.find(
										(l) => l.serviceCodeId === r.serviceCodeId,
									)
									const installedQty = inv?.qty ?? 0
									const orderedQty =
										ordered.find((o) => o.serviceCodeId === r.serviceCodeId)
											?.qty ?? 0
									const certifiedQty =
										certified?.find((c) => c.serviceCodeId === r.serviceCodeId)
											?.certifiedQty ?? installedQty
									const differs = r.qty !== installedQty
									return (
										<tr
											key={r.serviceCodeId}
											className="border-b last:border-0"
										>
											<td className="py-1.5 font-mono text-xs font-semibold">
												{r.claroCode}
											</td>
											<td className="py-1.5">{description(r.serviceCodeId)}</td>
											<td className="py-1.5 text-right">{orderedQty}</td>
											<td className="py-1.5 text-right">{installedQty}</td>
											<td className="py-1.5 text-right">{certifiedQty}</td>
											<td className="py-1.5 text-right">
												<Input
													type="number"
													min={0}
													value={r.qty}
													aria-label={`${t("docs_review_steps.col_charged")} ${r.claroCode}`}
													className={cn(
														"ml-auto w-20",
														active && differs && "border-status-warn",
													)}
													onChange={(e) =>
														update(i, {
															qty: Number.parseInt(e.target.value, 10) || 0,
														})
													}
												/>
											</td>
											<td className="py-1.5 text-right">
												<Input
													type="number"
													step="0.0001"
													min={0}
													value={r.unitPrice}
													aria-label={`${t("docs_review_steps.aviso_unit_price")} ${r.claroCode}`}
													className="ml-auto w-28"
													onChange={(e) =>
														update(i, {
															unitPrice: Number(e.target.value) || 0,
														})
													}
												/>
											</td>
											<td
												className={cn(
													"py-1.5 pl-2 text-xs font-medium whitespace-nowrap",
													active && differs
														? "text-status-warn"
														: "text-status-ok",
												)}
											>
												{active && differs
													? `⚠ ${t("docs_review_steps.status_qty")}`
													: `✓ ${t("docs_review_steps.status_ok")}`}
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
						<input
							type="hidden"
							name="avisoLines"
							value={JSON.stringify(rows)}
						/>

						{active && state === "qty" && (
							<div className="space-y-1">
								<Label htmlFor="lineNote" className="text-xs">
									{t("docs_review_steps.note_label")}{" "}
									<span className="font-normal text-muted-foreground">
										{t("docs_review_steps.note_required")}
									</span>
								</Label>
								<Textarea
									id="lineNote"
									name="lineNote"
									rows={2}
									required
									placeholder={t("docs_review_steps.note_placeholder")}
								/>
								<p className="text-xs text-muted-foreground">
									{t("docs_review_steps.note_footnote")}
								</p>
							</div>
						)}

						{error?.errorMessage ? (
							<p className="text-sm text-status-danger">{error.errorMessage}</p>
						) : error?.errorKey &&
							error.errorKey !== "docs_review.errors.aviso_amount_mismatch" ? (
							<p className="text-sm text-status-danger">
								{t(error.errorKey as ParseKeys)}
							</p>
						) : null}

						{!readOnly && (
							<div className="space-y-2">
								<Button type="submit" disabled={locked} className="w-full">
									{t(
										`docs_review_steps.button_${active ? state : "pending"}` as ParseKeys,
									)}
								</Button>
								{active && (
									<p className="text-center text-xs text-muted-foreground">
										{t(`docs_review_steps.footnote_${state}` as ParseKeys)}
									</p>
								)}
							</div>
						)}
					</fieldset>
				</Form>
				{children}
			</CardContent>
		</Card>
	)
}

function Total({
	label,
	value,
	sub,
	bad = false,
}: {
	label: string
	value: string
	sub: string
	bad?: boolean
}) {
	return (
		<div
			className={cn(
				"rounded-lg border p-3",
				bad ? "border-status-danger-line bg-status-danger-soft" : "bg-card",
			)}
		>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div
				className={cn(
					"text-lg font-bold tabular-nums",
					bad && "text-status-danger",
				)}
			>
				{value}
			</div>
			<div className="text-xs text-muted-foreground">{sub}</div>
		</div>
	)
}
