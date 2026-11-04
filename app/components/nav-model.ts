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
import {
	WAREHOUSE_QUEUE_LABEL_KEY,
	WAREHOUSE_QUEUES,
	warehouseQueueHref,
} from "~/lib/warehouse-queues"
import type { Role } from "../../generated/prisma/client"

export type NavLabelKey =
	| "app_shell.nav.dashboard"
	| "app_shell.nav.new_document"
	| "app_shell.nav.receivables"
	| "app_shell.nav.finance_packets"
	| "app_shell.nav.finance_returned"
	| "app_shell.nav.finance_avisos"
	| "app_shell.nav.finance_ledger"
	| "app_shell.nav.finance_payment_advice"
	| "app_shell.nav.finance_lc_request"
	| "app_shell.nav.finance_lists"
	| "app_shell.nav.finance_awaiting_po"
	| "app_shell.nav.finance_awaiting_ariba"
	| "app_shell.nav.admin_settings"
	| "app_shell.nav.catalog"
	| "app_shell.nav.admin_users"
	| "app_shell.nav.admin_vans"
	| "app_shell.nav.admin_claro_supervisors"
	| "app_shell.nav.supervisor_brigades"
	| "app_shell.nav.supervisor_variance"
	| "app_shell.nav.supervisor_stock"
	| "app_shell.nav.warehouse_brigade_stock"
	| "app_shell.nav.admin_restock"
	| "app_shell.nav.installer"
	| "app_shell.nav.installer_supervisor"
	| "app_shell.nav.installer_home"
	| "app_shell.nav.installer_new_job"
	| "app_shell.nav.installer_van"
	| "app_shell.nav.warehouse_scan_in"
	| "app_shell.nav.warehouse_restock"
	| "app_shell.nav.warehouse_stock"
	| "app_shell.nav.supervisor_open"
	| "app_shell.nav.supervisor_returned"
	| "app_shell.nav.supervisor_invoice"
	| "app_shell.nav.supervisor_aviso"
	| "app_shell.nav.supervisor_precert"
	| "app_shell.nav.supervisor_released"
	| "app_shell.nav.supervisor_all"
	| "app_shell.nav.warehouse_prep"
	| "app_shell.nav.warehouse_pickup"
	| "app_shell.nav.warehouse_returns"
	| "app_shell.nav.warehouse_repairs"
	| "app_shell.nav.warehouse_needs_review"
	| "app_shell.nav.warehouse_triage"
	| "app_shell.nav.warehouse_requests"
	| "app_shell.nav.warehouse_serials"
	| "app_shell.nav.warehouse_movements"
	| "app_shell.nav.comptroller_lists"
	| "app_shell.nav.comptroller_home"
	| "app_shell.nav.comptroller_to_pay"
	| "app_shell.nav.comptroller_paid"
	| "app_shell.nav.comptroller_brigades"
	| "app_shell.nav.comptroller_warranty_docs"
	| "app_shell.nav.comptroller_ewit"
	| "app_shell.nav.comptroller_pbcc_batches"
	| "app_shell.nav.comptroller_installer_pay"
	| "app_shell.nav.comptroller_log"
	| "app_shell.nav.comptroller_pbcc_wires"
	| "app_shell.nav.admin_reports"

export type NavCount = { value: number; tone: "critical" | "neutral" }

export type NavGroupKey =
	| "overview"
	| "workflow"
	| "work"
	| "team"
	| "arm_a"
	| "arm_b"
	| "money"
	| "brigades"
	| "installers"
	| "reports"
	| "stock"
	| "other"
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

// "work" leads "workflow" so the warehouse's prep -> pickup -> returns steps
// are the first thing under Dashboard.
const GROUP_ORDER: NavGroupKey[] = [
	"overview",
	"work",
	"workflow",
	"arm_a",
	"arm_b",
	"money",
	"brigades",
	"installers",
	"reports",
	"team",
	"stock",
	"other",
	"field",
	"admin",
]
export const GROUP_LABEL_KEY: Record<NavGroupKey, GroupLabelKey | null> = {
	overview: null,
	workflow: "app_shell.group.workflow",
	work: "app_shell.group.work",
	team: "app_shell.group.team",
	arm_a: "app_shell.group.arm_a",
	arm_b: "app_shell.group.arm_b",
	money: "app_shell.group.money",
	brigades: "app_shell.group.brigades",
	reports: "app_shell.group.reports",
	installers: "app_shell.group.installers",
	stock: "app_shell.group.stock",
	other: "app_shell.group.other",
	field: "app_shell.group.field",
	admin: "app_shell.group.admin",
}

// The supervisor's queues: My open jobs first, then one per step from Packets
// to Claro onward; each is a filtered view of the dashboard, not a separate
// screen. Intake has no link of its own (it opens from the "Awaiting
// warehouse" tile) and neither has Review, whose queue and route remain.
const SUPERVISOR_QUEUE_ITEMS: NavItem[] = (
	[
		["open", "app_shell.nav.supervisor_open"],
		["returned", "app_shell.nav.supervisor_returned"],
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

// The warehouse's steps, one page each: the job-rail steps it owns.
const WAREHOUSE_QUEUE_ITEMS: NavItem[] = WAREHOUSE_QUEUES.map((queue) => ({
	to: warehouseQueueHref(queue),
	labelKey: WAREHOUSE_QUEUE_LABEL_KEY[queue],
	icon: TruckDeliveryIcon,
	group: "work" as const,
	roles: ["WAREHOUSE"] as Role[],
}))

// Scan in, Restock and Stock: the warehouse's own flows. Admin keeps the same
// links under its existing "stock" group, so only Warehouse sees "workflow".
const warehouseFlowItems = (group: NavGroupKey, roles: Role[]): NavItem[] => [
	{
		to: "/warehouse/scan-in",
		labelKey: "app_shell.nav.warehouse_scan_in",
		icon: TruckDeliveryIcon,
		group,
		roles,
	},
	{
		to: "/warehouse/restock",
		labelKey: "app_shell.nav.warehouse_restock",
		icon: TruckDeliveryIcon,
		group,
		roles,
	},
	{
		to: "/warehouse/stock",
		labelKey: "app_shell.nav.warehouse_stock",
		icon: GridViewIcon,
		group,
		roles,
	},
]

// The warehouse's "workflow" group mirrors its step rail
// (`WAREHOUSE_STEPS`): Scan in, Triage, Needs review, Repairs, Restock, Stock.
const WAREHOUSE_WORKFLOW_ITEMS: NavItem[] = (
	[
		[
			"/warehouse/scan-in",
			"app_shell.nav.warehouse_scan_in",
			TruckDeliveryIcon,
		],
		["/warehouse/triage", "app_shell.nav.warehouse_triage", TruckDeliveryIcon],
		[
			"/warehouse/needs-review",
			"app_shell.nav.warehouse_needs_review",
			TruckDeliveryIcon,
		],
		[
			"/warehouse/repairs",
			"app_shell.nav.warehouse_repairs",
			TruckDeliveryIcon,
		],
		[
			"/warehouse/restock",
			"app_shell.nav.warehouse_restock",
			TruckDeliveryIcon,
		],
		[
			"/warehouse/brigade-stock",
			"app_shell.nav.warehouse_brigade_stock",
			TruckDeliveryIcon,
		],
		["/warehouse/stock", "app_shell.nav.warehouse_stock", GridViewIcon],
	] as [string, NavLabelKey, IconSvgElement][]
).map(([to, labelKey, icon]) => ({
	to,
	labelKey,
	icon,
	group: "workflow" as const,
	roles: ["WAREHOUSE"] as Role[],
}))

// The warehouse's reference views: each its own page.
const WAREHOUSE_OTHER_ITEMS: NavItem[] = (
	[
		["/warehouse/requests", "app_shell.nav.warehouse_requests"],
		["/warehouse/serials", "app_shell.nav.warehouse_serials"],
		["/warehouse/movements", "app_shell.nav.warehouse_movements"],
	] as [string, NavLabelKey][]
).map(([to, labelKey]) => ({
	to,
	labelKey,
	icon: TruckDeliveryIcon,
	group: "other" as const,
	roles: ["WAREHOUSE"] as Role[],
}))

const NAV_ITEMS: NavItem[] = [
	{
		to: "/dashboard",
		labelKey: "app_shell.nav.dashboard",
		icon: DashboardSquare01Icon,
		group: "overview",
		// The installer's home is /installer, the comptroller's is /comptroller.
		// Crew accounts no longer sign in, so CREW gets no navigation at all.
		hideFor: ["INSTALLER", "COMPTROLLER", "CREW"],
	},
	{
		to: "/comptroller",
		labelKey: "app_shell.nav.comptroller_home",
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
		to: "/supervisor/stock",
		labelKey: "app_shell.nav.supervisor_stock",
		icon: GridViewIcon,
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
		to: "/finance/queue?stage=returned",
		labelKey: "app_shell.nav.finance_returned",
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
		to: "/finance/payroll",
		labelKey: "app_shell.nav.finance_lists",
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
	},
	{
		to: "/finance/awaiting-ariba",
		labelKey: "app_shell.nav.finance_awaiting_ariba",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/payment-advice",
		labelKey: "app_shell.nav.finance_payment_advice",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/receivables",
		labelKey: "app_shell.nav.receivables",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/avisos",
		labelKey: "app_shell.nav.finance_avisos",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/ledger",
		labelKey: "app_shell.nav.finance_ledger",
		icon: Invoice02Icon,
		group: "arm_b",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/comptroller/to-pay",
		labelKey: "app_shell.nav.comptroller_to_pay",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/brigades",
		labelKey: "app_shell.nav.comptroller_brigades",
		icon: UserGroup03Icon,
		group: "brigades",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/pbcc-wires",
		labelKey: "app_shell.nav.comptroller_pbcc_wires",
		icon: Invoice02Icon,
		group: "brigades",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/log",
		labelKey: "app_shell.nav.comptroller_log",
		icon: Invoice02Icon,
		group: "reports",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/installers",
		labelKey: "app_shell.nav.comptroller_warranty_docs",
		icon: FileAddIcon,
		group: "installers",
		roles: ["COMPTROLLER", "ADMIN"],
		exact: true,
	},
	{
		to: "/comptroller/installers/ewit",
		labelKey: "app_shell.nav.comptroller_ewit",
		icon: Invoice02Icon,
		group: "installers",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/installers/batches",
		labelKey: "app_shell.nav.comptroller_pbcc_batches",
		icon: GridViewIcon,
		group: "installers",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/comptroller/installers/pay",
		labelKey: "app_shell.nav.comptroller_installer_pay",
		icon: Wallet01Icon,
		group: "money",
		roles: ["COMPTROLLER", "ADMIN"],
	},

	...WAREHOUSE_WORKFLOW_ITEMS,
	...WAREHOUSE_QUEUE_ITEMS,
	...WAREHOUSE_OTHER_ITEMS,
	...warehouseFlowItems("stock", ["ADMIN"]),
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
		to: "/reports",
		labelKey: "app_shell.nav.admin_reports",
		icon: Invoice02Icon,
		group: "admin",
		roles: ["ADMIN"],
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
		to: "/admin/vans",
		labelKey: "app_shell.nav.admin_vans",
		icon: TruckDeliveryIcon,
		group: "admin",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/claro-supervisors",
		labelKey: "app_shell.nav.admin_claro_supervisors",
		icon: UserIcon,
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
	// Payroll requests is one menu item: its Paid tab and each request page keep it lit.
	const here =
		path === "/comptroller/to-pay" &&
		(location.pathname === "/comptroller/paid" ||
			location.pathname.startsWith("/comptroller/runs/"))
	if (location.pathname !== path && !here) return false
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

/** Only the installer works from a phone tab bar. */
export function tabBarItemsFor(role: Role): NavItem[] {
	return role === "INSTALLER" ? INSTALLER_TABS : []
}
