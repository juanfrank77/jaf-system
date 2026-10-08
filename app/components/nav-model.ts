import {
	DashboardSquare01Icon,
	FileAddIcon,
	GridViewIcon,
	Home01Icon,
	Invoice02Icon,
	Settings02Icon,
	TruckDeliveryIcon,
	UserGroup03Icon,
	UserIcon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { Role } from "../../generated/prisma/client"

export type NavLabelKey =
	| "app_shell.nav.dashboard"
	| "app_shell.nav.new_document"
	| "app_shell.nav.receivables"
	| "app_shell.nav.finance_queue"
	| "app_shell.nav.finance_payroll"
	| "app_shell.nav.admin_settings"
	| "app_shell.nav.catalog"
	| "app_shell.nav.comptroller"
	| "app_shell.nav.admin_users"
	| "app_shell.nav.admin_crews"
	| "app_shell.nav.admin_vans"
	| "app_shell.nav.supervisor_brigades"
	| "app_shell.nav.supervisor_variance"
	| "app_shell.nav.admin_restock"
	| "app_shell.nav.installer"
	| "app_shell.nav.installer_supervisor"
	| "app_shell.nav.installer_home"
	| "app_shell.nav.installer_new_job"
	| "app_shell.nav.installer_van"
	| "app_shell.nav.warehouse_scan_in"
	| "app_shell.nav.warehouse_restock"
	| "app_shell.nav.warehouse_stock"

export type NavCount = { value: number; tone: "critical" | "neutral" }

export type NavGroupKey =
	| "overview"
	| "work"
	| "money"
	| "stock"
	| "field"
	| "admin"
type GroupLabelKey = `app_shell.group.${Exclude<NavGroupKey, "overview">}`

export type NavItem = {
	to: string
	labelKey: NavLabelKey
	icon: IconSvgElement
	group: NavGroupKey
	roles?: Role[]
	/** Active only on this exact path (a Home tab must not light up on every sub-page). */
	exact?: boolean
}
export type NavGroup = { key: NavGroupKey; items: NavItem[] }

const GROUP_ORDER: NavGroupKey[] = [
	"overview",
	"work",
	"money",
	"stock",
	"field",
	"admin",
]
export const GROUP_LABEL_KEY: Record<NavGroupKey, GroupLabelKey | null> = {
	overview: null,
	work: "app_shell.group.work",
	money: "app_shell.group.money",
	stock: "app_shell.group.stock",
	field: "app_shell.group.field",
	admin: "app_shell.group.admin",
}

const NAV_ITEMS: NavItem[] = [
	{
		to: "/dashboard",
		labelKey: "app_shell.nav.dashboard",
		icon: DashboardSquare01Icon,
		group: "overview",
	},
	{
		to: "/docs/new",
		labelKey: "app_shell.nav.new_document",
		icon: FileAddIcon,
		group: "work",
		roles: ["SUPERVISOR", "ADMIN"],
	},
	{
		to: "/supervisor/brigades",
		labelKey: "app_shell.nav.supervisor_brigades",
		icon: UserGroup03Icon,
		group: "work",
		roles: ["SUPERVISOR"],
	},
	{
		to: "/supervisor/variance",
		labelKey: "app_shell.nav.supervisor_variance",
		icon: Invoice02Icon,
		group: "work",
		roles: ["SUPERVISOR"],
	},
	{
		to: "/finance/queue",
		labelKey: "app_shell.nav.finance_queue",
		icon: Invoice02Icon,
		group: "money",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/payroll",
		labelKey: "app_shell.nav.finance_payroll",
		icon: Invoice02Icon,
		group: "money",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/receivables",
		labelKey: "app_shell.nav.receivables",
		icon: Invoice02Icon,
		group: "money",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/comptroller",
		labelKey: "app_shell.nav.comptroller",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/warehouse/scan-in",
		labelKey: "app_shell.nav.warehouse_scan_in",
		icon: TruckDeliveryIcon,
		group: "stock",
		roles: ["WAREHOUSE", "ADMIN"],
	},
	{
		to: "/warehouse/restock",
		labelKey: "app_shell.nav.warehouse_restock",
		icon: TruckDeliveryIcon,
		group: "stock",
		roles: ["WAREHOUSE", "ADMIN"],
	},
	{
		to: "/warehouse/stock",
		labelKey: "app_shell.nav.warehouse_stock",
		icon: GridViewIcon,
		group: "stock",
		roles: ["WAREHOUSE", "ADMIN"],
	},
	{
		to: "/installer",
		labelKey: "app_shell.nav.installer",
		icon: TruckDeliveryIcon,
		group: "field",
		roles: ["INSTALLER", "ADMIN"],
	},
	{
		to: "/installer-supervisor",
		labelKey: "app_shell.nav.installer_supervisor",
		icon: TruckDeliveryIcon,
		group: "field",
		roles: ["INSTALLER_SUPERVISOR", "ADMIN"],
	},
	{
		to: "/admin/settings",
		labelKey: "app_shell.nav.admin_settings",
		icon: Settings02Icon,
		group: "admin",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/catalog",
		labelKey: "app_shell.nav.catalog",
		icon: GridViewIcon,
		group: "admin",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/users",
		labelKey: "app_shell.nav.admin_users",
		icon: UserIcon,
		group: "admin",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/crews",
		labelKey: "app_shell.nav.admin_crews",
		icon: UserGroup03Icon,
		group: "admin",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/vans",
		labelKey: "app_shell.nav.admin_vans",
		icon: TruckDeliveryIcon,
		group: "admin",
		roles: ["ADMIN"],
	},
]

function visibleItems(role: Role, opts: { comptrollerEnabled?: boolean }) {
	return NAV_ITEMS.filter((item) => {
		if (item.to.startsWith("/comptroller") && !opts.comptrollerEnabled)
			return false
		return !item.roles || item.roles.includes(role)
	})
}

export function navGroupsFor(
	role: Role,
	opts: { comptrollerEnabled?: boolean } = {},
): NavGroup[] {
	const items = visibleItems(role, opts)
	return GROUP_ORDER.map((key) => ({
		key,
		items: items.filter((i) => i.group === key),
	})).filter((g) => g.items.length > 0)
}

const TAB_BAR_ROLES: readonly Role[] = ["CREW", "INSTALLER"]

// The installer's phone tabs are their own list, not the sidebar items:
// Swap and Restock stay reachable from Home and My van.
const INSTALLER_TABS: NavItem[] = [
	{
		to: "/installer",
		labelKey: "app_shell.nav.installer_home",
		icon: Home01Icon,
		group: "field",
		exact: true,
	},
	{
		to: "/installer/completion/new",
		labelKey: "app_shell.nav.installer_new_job",
		icon: FileAddIcon,
		group: "field",
	},
	{
		to: "/installer/van",
		labelKey: "app_shell.nav.installer_van",
		icon: TruckDeliveryIcon,
		group: "field",
	},
]

export function tabBarItemsFor(
	role: Role,
	opts: { comptrollerEnabled?: boolean } = {},
): NavItem[] {
	if (!TAB_BAR_ROLES.includes(role)) return []
	if (role === "INSTALLER") return INSTALLER_TABS
	const items = visibleItems(role, opts)
	return items.length >= 2 ? items.slice(0, 4) : []
}
