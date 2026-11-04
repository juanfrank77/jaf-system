import { useTranslation } from "react-i18next"
import { Link } from "react-router"

/** Payroll requests is one menu item; this is its To pay / Paid switch. */
export function ComptrollerRequestTabs({ tab }: { tab: "to-pay" | "paid" }) {
	const { t } = useTranslation()
	const cls = (active: boolean) =>
		active
			? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
			: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
	return (
		<nav className="flex border-b">
			<Link to="/comptroller/to-pay" className={cls(tab === "to-pay")}>
				{t("comptroller_payroll.tab_to_pay")}
			</Link>
			<Link to="/comptroller/paid" className={cls(tab === "paid")}>
				{t("comptroller_payroll.tab_paid")}
			</Link>
		</nav>
	)
}
