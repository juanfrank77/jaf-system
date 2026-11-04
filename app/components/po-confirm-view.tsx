import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { useCheckText } from "~/components/po-inbox-view"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import type { PoDetailView } from "~/lib/po-inbox-view"
import { formatMoney } from "~/lib/utils"

export type PoConfirmError =
	| "po_inbox.errors.not_confirmable"
	| "po_inbox.errors.incomplete"
	| "po_inbox.errors.duplicate"
	| "po_inbox.errors.aviso_not_found"
	| "po_inbox.errors.already_confirmed"
	| "po_inbox.errors.unknown"

function Field({
	name,
	label,
	value,
	type = "text",
	disabled,
	step,
}: {
	name: string
	label: string
	value: string | number | null
	type?: string
	disabled?: boolean
	step?: string
}) {
	return (
		<div className="space-y-1">
			<Label htmlFor={`po-${name}`}>{label}</Label>
			<Input
				id={`po-${name}`}
				name={name}
				type={type}
				step={step}
				defaultValue={value ?? ""}
				disabled={disabled}
			/>
		</div>
	)
}

/** W5b: the PO image on the left, the fields it was read into on the right. */
export function PoConfirmView({
	po,
	errorKey,
}: {
	po: PoDetailView
	errorKey?: PoConfirmError
}) {
	const { t } = useTranslation()
	const checkText = useCheckText()
	const locked = po.status === "CONFIRMED"
	const confirmable = po.status === "READY" || po.status === "NEEDS_LOOK"
	const thisPo = po.subtotal ?? 0
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<div className="space-y-2">
				<object
					data={`/finance/awaiting-po/${po.id}/file`}
					type="application/pdf"
					aria-label={t("po_inbox.image")}
					className="h-[75vh] w-full rounded-lg border"
				>
					<a href={`/finance/awaiting-po/${po.id}/file`} className="underline">
						{t("po_inbox.open_file")}
					</a>
				</object>
				{po.statedPages !== null && (
					<p className="text-xs text-muted-foreground">
						{t("po_inbox.pages", {
							have: po.filePages ?? 0,
							of: po.statedPages,
						})}
					</p>
				)}
			</div>
			<div className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold">
						{t("po_inbox.po_title", { number: po.poNumber ?? po.fileName })}
					</h2>
					{po.checks.length === 0 ? (
						<Badge variant="ok">{t("po_inbox.all_passed")}</Badge>
					) : (
						<Badge variant="warn">
							{t("po_inbox.n_checks", { count: po.checks.length })}
						</Badge>
					)}
					{locked && <Badge variant="ok">{t("po_inbox.tab.confirmed")}</Badge>}
				</div>
				{errorKey && (
					<p role="alert" className="text-sm text-status-danger">
						{t(errorKey)}
					</p>
				)}
				{po.readError && (
					<p className="text-sm text-status-warn">
						{t("po_inbox.read_failed")}
					</p>
				)}
				{po.checks.length > 0 && (
					<ul className="list-disc space-y-0.5 pl-5 text-sm">
						{po.checks.map((c) => (
							<li key={`${c.code}-${c.detail ?? ""}`}>{checkText(c)}</li>
						))}
					</ul>
				)}
				<Form method="post" className="space-y-3 rounded-lg border bg-card p-3">
					<input type="hidden" name="intent" value="fix" />
					<div className="grid grid-cols-2 gap-3">
						<Field
							name="poNumber"
							label={t("po_inbox.field.po")}
							value={po.poNumber}
							disabled={locked}
						/>
						<Field
							name="poDate"
							label={t("po_inbox.field.date")}
							value={po.poDate}
							type="date"
							disabled={locked}
						/>
						<Field
							name="avisoNumber"
							label={t("po_inbox.field.aviso")}
							value={po.avisoNumber}
							disabled={locked}
						/>
						<Field
							name="termsDays"
							label={t("po_inbox.field.terms")}
							value={po.termsDays}
							type="number"
							disabled={locked}
						/>
						<Field
							name="subtotal"
							label={t("po_inbox.field.subtotal")}
							value={po.subtotal}
							type="number"
							step="0.01"
							disabled={locked}
						/>
						<Field
							name="ivu4"
							label={t("po_inbox.field.ivu4")}
							value={po.ivu4}
							type="number"
							step="0.01"
							disabled={locked}
						/>
						<Field
							name="ivu115"
							label={t("po_inbox.field.ivu115")}
							value={po.ivu115}
							type="number"
							step="0.01"
							disabled={locked}
						/>
						<Field
							name="total"
							label={t("po_inbox.field.total")}
							value={po.total}
							type="number"
							step="0.01"
							disabled={locked}
						/>
					</div>
					{!locked && (
						<Button type="submit" variant="secondary">
							{t("po_inbox.save_fix")}
						</Button>
					)}
				</Form>
				{po.lines.length > 0 && (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="p-1">{t("po_inbox.line.item")}</th>
								<th className="p-1 text-right">{t("po_inbox.line.amount")}</th>
								<th className="p-1 text-right">{t("po_inbox.line.rate")}</th>
								<th className="p-1 text-right">{t("po_inbox.line.ivu")}</th>
							</tr>
						</thead>
						<tbody>
							{po.lines.map((l) => (
								<tr
									key={l.item + l.description}
									className="border-b last:border-0"
								>
									<td className="p-1">{l.item}</td>
									<td className="p-1 text-right font-mono">
										{formatMoney(l.amount)}
									</td>
									<td className="p-1 text-right font-mono">
										{+(l.ivuRate * 100).toFixed(2)}%
									</td>
									<td className="p-1 text-right font-mono">
										{formatMoney(l.ivu)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				{po.avisoNumber && po.billed !== null && (
					<p className="text-sm">
						{t("po_inbox.aviso_money", {
							billed: formatMoney(po.billed),
							already: formatMoney(po.alreadyPod),
							thisPo: formatMoney(thisPo),
						})}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{confirmable && (
						<Form method="post">
							<input type="hidden" name="intent" value="confirm_one" />
							<input type="hidden" name="id" value={po.id} />
							<Button type="submit">{t("po_inbox.confirm_po")}</Button>
						</Form>
					)}
					{!locked && (
						<Form method="post">
							<input type="hidden" name="intent" value="reread" />
							<Button type="submit" variant="outline">
								{t("po_inbox.reread")}
							</Button>
						</Form>
					)}
					<Link to="/finance/awaiting-po" className="text-sm underline">
						{t("po_inbox.back")}
					</Link>
				</div>
			</div>
		</div>
	)
}
