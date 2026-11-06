import { useTranslation } from "react-i18next"
import type { PoCheck } from "~/lib/po-reading"

/** One literal key per check, because `t()` is typed by the locale files. */
export function useCheckText() {
	const { t } = useTranslation()
	return (c: PoCheck): string => {
		const detail = c.detail ?? ""
		switch (c.code) {
			case "lines_sum":
				return t("po_inbox.check.lines_sum", { detail })
			case "totals":
				return t("po_inbox.check.totals")
			case "ivu_line":
				return t("po_inbox.check.ivu_line", { detail })
			case "po_number_format":
				return t("po_inbox.check.po_number_format")
			case "duplicate":
				return t("po_inbox.check.duplicate")
			case "pages_missing":
				return t("po_inbox.check.pages_missing", { detail })
			case "pages_unknown":
				return t("po_inbox.check.pages_unknown")
			case "po_date_missing":
				return t("po_inbox.check.po_date_missing")
			case "terms_missing":
				return t("po_inbox.check.terms_missing")
			case "over_billed":
				return t("po_inbox.check.over_billed", { detail })
			case "unreadable":
				return t("po_inbox.check.unreadable")
		}
	}
}
