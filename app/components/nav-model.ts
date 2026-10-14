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
import {
	type SupervisorQueue,
	supervisorQueueHref,
} from "~/lib/supervisor-queues"
import type { Role } from "../../generated/prisma/client"

export type NavLabelKey =
	| "app_shell.nav.dashboard"
	| "app_shell.nav.new_document"
	| "app_shell.nav.receivables"
	| "app_shell.nav.finance_packets"
	| "app_shell.nav.finance_lc_request"
	| "app_shell.nav.finance_lc_funded"
	| "app_shell.nav.finance_lists"
	| "app_shell.nav.finance_carmen"
	| "app_shell.nav.finance_awaiting_po"
	| "app_shell.nav.finance_awaiting_ariba"
	| "app_shell.nav.admin_settings"
	| "app_shell.nav.catalog"
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
	| "app_shell.nav.supervisor_review"
	| "app_shell.nav.supervisor_invoice"
	| "app_shell.nav.supervisor_aviso"
	| "app_shell.nav.supervisor_precert"
	| "app_shell.nav.supervisor_released"
	| "app_shell.nav.supervisor_all"
	| "app_shell.nav.warehouse_prep"
	| "app_shell.nav.warehouse_pickup"
	| "app_shell.nav.warehouse_returns"
	| "app_shell.nav.warehouse_inventory"
	| "app_shell.nav.warehouse_requests"
	| "app_shell.nav.warehouse_serials"
	| "app_shell.nav.warehouse_movements"
	| "app_shell.nav.comptroller_lists"
	| "app_shell.nav.comptroller_to_pay"
	| "app_shell.nav.comptroller_paid"
	| "app_shell.nav.comptroller_installers"

export type NavCount = { value: number; tone: "critical" | "neutral" }

export type NavGroupKey =
	| "overview"
	| "work"
	| "team"
	| "arm_a"
	| "arm_b"
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
	/** Roles that never see this item even though `roles` is open. */
	hideFor?: Role[]
	/** Active only on this exact path (a Home tab must not light up on every sub-page). */
	exact?: boolean
	/** Visible placeholder, not a link (screen not built yet). */
	disabled?: boolean
}
export type NavGroup = { key: NavGroupKey; items: NavItem[] }

const GROUP_ORDER: NavGroupKey[] = [
	"overview",
	"work",
	"team",
	"arm_a",
	"arm_b",
	"money",
	"stock",
	"field",
	"admin",
]
export const GROUP_LABEL_KEY: Record<NavGroupKey, GroupLabelKey | null> = {
	overview: null,
	work: "app_shell.group.work",
	team: "app_shell.group.team",
	arm_a: "app_shell.group.arm_a",
	arm_b: "app_shell.group.arm_b",
	money: "app_shell.group.money",
	stock: "app_shell.group.stock",
	field: "app_shell.group.field",
	admin: "app_shell.group.admin",
}

// The supervisor's queues, in step-rail order from Approve onward: each is a
// filtered view of the dashboard, not a separate screen.
const SUPERVISOR_QUEUE_ITEMS: NavItem[] = (
	[
		["review", "app_shell.nav.supervisor_review"],
		["invoice", "app_shell.nav.supervisor_invoice"],
		["aviso", "app_shell.nav.supervisor_aviso"],
		["precert", "app_shell.nav.supervisor_precert"],
		["released", "app_shell.nav.supervisor_released"],
		["all", "app_shell.nav.supervisor_all"],
	] as [SupervisorQueue, NavLabelKey][]
).map(([queue, labelKey]) => ({
	to: supervisorQueueHref(queue),
	labelKey,
	icon: Invoice02Icon,
	group: "work" as const,
	roles: ["SUPERVISOR"] as Role[],
}))

// The warehouse's queues: sections of the dashboard and of the stock and
// restock screens, reached by anchor.
const WAREHOUSE_QUEUE_ITEMS: NavItem[] = (
	[
		["/dashboard#to-prep", "app_shell.nav.warehouse_prep"],
		["/dashboard#awaiting-pickup", "app_shell.nav.warehouse_pickup"],
		["/dashboard#returns-due", "app_shell.nav.warehouse_returns"],
		["/warehouse/stock#inventory", "app_shell.nav.warehouse_inventory"],
		["/warehouse/restock#requests", "app_shell.nav.warehouse_requests"],
		["/warehouse/stock#serials", "app_shell.nav.warehouse_serials"],
		["/warehouse/stock#movements", "app_shell.nav.warehouse_movements"],
	] as [string, NavLabelKey][]
).map(([to, labelKey]) => ({
	to,
	labelKey,
	icon: TruckDeliveryIcon,
	group: "work" as const,
	roles: ["WAREHOUSE"] as Role[],
}))

const NAV_ITEMS: NavItem[] = [
	{
		to: "/dashboard",
		labelKey: "app_shell.nav.dashboard",
		icon: DashboardSquare01Icon,
		group: "overview",
		// The installer's home is /installer, the comptroller's is /comptroller.
		hideFor: ["INSTALLER", "COMPTROLLER"],
	},
	{
		to: "/comptroller",
		labelKey: "app_shell.nav.dashboard",
		icon: DashboardSquare01Icon,
		group: "overview",
		roles: ["COMPTROLLER"],
	},
	{
		to: "/docs/new",
		labelKey: "app_shell.nav.new_document",
		icon: FileAddIcon,
		group: "work",
		roles: ["SUPERVISOR", "ADMIN"],
	},
	...SUPERVISOR_QUEUE_ITEMS,
	{
		to: "/supervisor/brigades",
		labelKey: "app_shell.nav.supervisor_brigades",
		icon: UserGroup03Icon,
		group: "team",
		roles: ["SUPERVISOR"],
	},
	{
		to: "/supervisor/variance",
		labelKey: "app_shell.nav.supervisor_variance",
		icon: Invoice02Icon,
		group: "team",
		roles: ["SUPERVISOR"],
	},
	{
		to: "/finance/queue",
		labelKey: "app_shell.nav.finance_packets",
		icon: Invoice02Icon,
		group: "arm_a",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/lc-requests",
		labelKey: "app_shell.nav.finance_lc_request",
		icon: Invoice02Icon,
		group: "arm_a",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/lc-funded",
		labelKey: "app_shell.nav.finance_lc_funded",
		icon: Invoice02Icon,
		group: "arm_a",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/payroll",
		labelKey: "app_shell.nav.finance_lists",
		icon: Invoice02Icon,
		group: "arm_a",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/awaiting-carmen",
		labelKey: "app_shell.nav.finance_carmen",
		icon: Invoice02Icon,
		group: "arm_a",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/awaiting-po",
		labelKey: "app_shell.nav.finance_awaiting_po",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
		disabled: true,
	},
	{
		to: "/finance/awaiting-ariba",
		labelKey: "app_shell.nav.finance_awaiting_ariba",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
		disabled: true,
	},
	{
		to: "/finance/receivables",
		labelKey: "app_shell.nav.receivables",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/comptroller/lists",
		labelKey: "app_shell.nav.comptroller_lists",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/to-pay",
		labelKey: "app_shell.nav.comptroller_to_pay",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/paid",
		labelKey: "app_shell.nav.comptroller_paid",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/installers",
		labelKey: "app_shell.nav.comptroller_installers",
		icon: UserGroup03Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
		disabled: true,
	},
	...WAREHOUSE_QUEUE_ITEMS,
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

/**
 * Whether a nav link is the one on screen. Queue links share a path with
 * their siblings and differ only by `?stage=` or `#anchor`, so those must
 * match exactly; a plain link is active only when no queue is selected.
 */
export function isNavItemActive(
	to: string,
	location: { pathname: string; search: string; hash: string },
): boolean {
	const [rest, hash = ""] = to.split("#")
	const [path, search = ""] = rest.split("?")
	if (location.pathname !== path) return false
	if (search) {
		return (
			new URLSearchParams(location.search).get("stage") ===
			new URLSearchParams(search).get("stage")
		)
	}
	if (hash) return location.hash === `#${hash}`
	return !new URLSearchParams(location.search).has("stage") && !location.hash
}

type NavOpts = { varianceEnabled?: boolean }

function visibleItems(role: Role, opts: NavOpts) {
	return NAV_ITEMS.filter((item) => {
		if (item.to === "/supervisor/variance" && !opts.varianceEnabled)
			return false
		if (item.hideFor?.includes(role)) return false
		return !item.roles || item.roles.includes(role)
	})
}

export function navGroupsFor(role: Role, opts: NavOpts = {}): NavGroup[] {
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

export function tabBarItemsFor(role: Role, opts: NavOpts = {}): NavItem[] {
	if (!TAB_BAR_ROLES.includes(role)) return []
	if (role === "INSTALLER") return INSTALLER_TABS
	const items = visibleItems(role, opts)
	return items.length >= 2 ? items.slice(0, 4) : []
}
