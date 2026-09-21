import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Note } from "./primitives"

export type InstallerParStatus = {
	hasParLevels: boolean
	belowParCount: number
}

export function ParStatusBanner({
	parStatus,
	hasPendingRestock,
}: {
	parStatus: InstallerParStatus
	hasPendingRestock: boolean
}) {
	const { t } = useTranslation()

	if (!parStatus.hasParLevels) {
		return <Note tone="neutral">{t("ds.installer.adjust_banner_no_par")}</Note>
	}

	if (parStatus.belowParCount === 0) {
		return <Note tone="ok">{t("ds.installer.adjust_banner_at_par")}</Note>
	}

	if (hasPendingRestock) {
		return (
			<Note tone="warn">
				{t("ds.installer.adjust_banner_below_restock_pending", {
					count: parStatus.belowParCount,
				})}
			</Note>
		)
	}

	return (
		<Note tone="warn">
			{t("ds.installer.adjust_banner_below_restock_link", {
				count: parStatus.belowParCount,
			})}{" "}
			<Link to="/installer/restock">{t("installer.request_restock")}</Link>
		</Note>
	)
}
