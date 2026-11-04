import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServicePicker } from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Textarea } from "~/components/ui/textarea"
import type { ServiceLine } from "~/lib/service-lines"
import { formatMoney } from "~/lib/utils"

type MaterialProps = ComponentProps<typeof MaterialLineItems>

/**
 * Lissette edits the lines to match the Aviso, which stays open beside this. She
 * never types a price: the catalog sets it. Brigades are not here on purpose;
 * those go back to the supervisor.
 */
export function CorrectToAvisoForm({
	lines,
	materials,
	serviceCodes,
	onCancel,
	submitting,
}: {
	lines: (ServiceLine & { unit: string | null; unitPrice: number })[]
	materials: MaterialProps["initialItems"]
	serviceCodes: MaterialProps["serviceCodes"]
	onCancel: () => void
	submitting: boolean
}) {
	const { t } = useTranslation()
	return (
		<Form
			method="post"
			className="space-y-3 rounded-lg border-2 border-primary/30 bg-card p-4"
			data-testid="correct-to-aviso"
		>
			<input type="hidden" name="intent" value="correct_to_aviso" />
			<div>
				<h2 className="text-sm font-medium">
					{t("finance_verify.correct.heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("finance_verify.correct.hint")}
				</p>
			</div>
			<ServicePicker
				name="services"
				initialLines={lines}
				initialMeta={Object.fromEntries(
					lines.map((l) => [
						l.serviceCodeId,
						{ unit: l.unit, unitPrice: l.unitPrice },
					]),
				)}
			/>
			<div className="space-y-1">
				<p className="text-xs font-medium text-muted-foreground">
					{t("finance_verify.materials_heading")}
				</p>
				<MaterialLineItems
					serviceCodes={serviceCodes}
					initialItems={materials}
					name="materials"
				/>
			</div>
			<Textarea
				name="note"
				rows={2}
				placeholder={t("finance_verify.correct.note")}
			/>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm" disabled={submitting}>
					{t("finance_verify.correct.save")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					{t("finance_verify.correct.cancel")}
				</Button>
			</div>
		</Form>
	)
}

export type CorrectionView = {
	version: number
	original: {
		lines: { claroCode: string; name: string; qty: number }[]
		lineTotal: number
	}
	log: {
		id: string
		version: number
		at: string
		by: string
		note: string | null
		changes: {
			kind: string
			code: string
			name: string
			from: number | null
			to: number | null
		}[]
	}[]
}

/** v1 and every later version, with who changed what. */
export function CorrectionHistory({
	correction,
}: {
	correction: CorrectionView
}) {
	const { t } = useTranslation()
	return (
		<div
			className="space-y-2 rounded-lg border bg-card p-4 text-sm"
			data-testid="correction-history"
		>
			<h2 className="text-sm font-medium">
				{t("finance_verify.correct.history", { version: correction.version })}
			</h2>
			<div>
				<p className="text-xs font-medium text-muted-foreground">
					{t("finance_verify.correct.v1", {
						total: formatMoney(correction.original.lineTotal),
					})}
				</p>
				<ul className="text-xs text-muted-foreground">
					{correction.original.lines.map((l) => (
						<li key={l.claroCode}>
							{l.claroCode} {l.name} × {l.qty}
						</li>
					))}
				</ul>
			</div>
			{correction.log.map((e) => (
				<div key={e.id}>
					<p className="text-xs font-medium" suppressHydrationWarning>
						{t("finance_verify.correct.vn", { version: e.version, by: e.by })} ·{" "}
						{new Date(e.at).toLocaleString()}
					</p>
					<ul className="text-xs">
						{e.changes.map((c) => (
							<li key={`${c.kind}-${c.code}`}>
								{c.code} {c.name}: {c.from ?? t("finance_verify.correct.none")}{" "}
								→ {c.to ?? t("finance_verify.correct.removed")}
							</li>
						))}
					</ul>
					{e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
				</div>
			))}
		</div>
	)
}
