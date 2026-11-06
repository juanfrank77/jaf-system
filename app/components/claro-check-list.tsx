import { useTranslation } from "react-i18next"
import { useCheckText } from "~/components/po-inbox-view"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import type { CheckRow, CheckRowKey, ReviewField } from "~/lib/claro-po-view"

export const GENERATE_FORM_ID = "claro-generate"

function useRowLabel() {
	const { t } = useTranslation()
	return (key: CheckRowKey): string => {
		switch (key) {
			case "lines_sum":
				return t("claro.check.lines_sum")
			case "totals":
				return t("claro.check.totals")
			case "pages":
				return t("claro.check.pages")
			case "duplicate":
				return t("claro.check.duplicate")
			case "po_number_format":
				return t("claro.check.po_number_format")
			case "po_date_missing":
				return t("claro.check.po_date_missing")
			case "terms_missing":
				return t("claro.check.terms_missing")
			case "over_billed":
				return t("claro.check.over_billed")
			case "unreadable":
				return t("claro.check.unreadable")
		}
	}
}

export function useFieldLabel() {
	const { t } = useTranslation()
	return (f: ReviewField): string => {
		switch (f) {
			case "poNumber":
				return t("po_inbox.field.po")
			case "poDate":
				return t("po_inbox.field.date")
			case "avisoNumber":
				return t("po_inbox.field.aviso")
			case "termsDays":
				return t("po_inbox.field.terms")
			case "statedPages":
				return t("claro.review.stated_pages")
			case "lines":
				return t("claro.review.lines")
			case "subtotal":
				return t("po_inbox.field.subtotal")
			case "ivu4":
				return t("po_inbox.field.ivu4")
			case "ivu115":
				return t("po_inbox.field.ivu115")
			case "total":
				return t("po_inbox.field.total")
		}
	}
}

/**
 * The checks beside the data: each passes or fails, a failure says what is
 * wrong and which field on the left to fix. With `askReasons`, a failure that
 * can be overridden carries a reason box posted with Generate; a hard stop
 * never does.
 */
export function ClaroCheckList({
	rows,
	askReasons,
}: {
	rows: CheckRow[]
	askReasons: boolean
}) {
	const { t } = useTranslation()
	const checkText = useCheckText()
	const rowLabel = useRowLabel()
	const fieldLabel = useFieldLabel()
	return (
		<section
			aria-labelledby="claro-checks"
			className="space-y-2 rounded-lg border bg-card p-3"
		>
			<h2 id="claro-checks" className="text-sm font-semibold">
				{t("claro.review.checks")}
			</h2>
			<ul className="space-y-2">
				{rows.map((row) => {
					const failed = row.failing.length > 0
					return (
						<li
							key={row.key}
							data-testid={`check-${row.key}`}
							data-state={failed ? "fail" : "pass"}
							className={
								failed
									? "space-y-1.5 rounded-md border border-status-danger/40 bg-status-danger-soft p-2"
									: "flex items-center justify-between gap-2 px-2 py-1"
							}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm font-medium">{rowLabel(row.key)}</span>
								<Badge variant={failed ? "danger" : "ok"}>
									{failed ? t("claro.check.fail") : t("claro.check.pass")}
								</Badge>
							</div>
							{failed && (
								<>
									<ul className="list-disc pl-5 text-sm">
										{row.failing.map((c) => (
											<li key={`${c.code}-${c.detail ?? ""}`}>
												{checkText(c)}
											</li>
										))}
									</ul>
									{row.fields.length > 0 && (
										<p className="text-xs text-muted-foreground">
											{t("claro.review.fix_in", {
												fields: row.fields.map(fieldLabel).join(", "),
											})}
										</p>
									)}
									{row.hardStop ? (
										<p className="text-xs font-medium text-status-danger">
											{t("claro.review.no_override")}
										</p>
									) : (
										askReasons &&
										row.overridable.map((code) => (
											<div key={code} className="space-y-1">
												<label
													htmlFor={`override-${code}`}
													className="text-xs font-medium"
												>
													{t("claro.review.reason")}
												</label>
												<Input
													id={`override-${code}`}
													name={`override-${code}`}
													form={GENERATE_FORM_ID}
													required
													maxLength={500}
													placeholder={t("claro.review.reason_hint")}
												/>
											</div>
										))
									)}
								</>
							)}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
