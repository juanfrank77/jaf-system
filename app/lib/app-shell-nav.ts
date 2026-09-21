import {
	FileAddIcon,
	GridViewIcon,
	HardHatIcon,
	Home01Icon,
	Invoice02Icon,
	MoneyExchange02Icon,
	PackageIcon,
	Settings02Icon,
	TruckDeliveryIcon,
	UserGroup03Icon,
	UserIcon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { Role } from "../../generated/prisma/client"

export type NavGroup = "home" | "finance" | "field" | "admin"

export type NavLabelKey =
	| "app_shell.nav.dashboard"
	| "app_shell.nav.receivables"
	| "app_shell.nav.finance_queue"
	| "app_shell.nav.admin_settings"
	| "app_shell.nav.catalog"
	| "app_shell.nav.comptroller"
	| "app_shell.nav.admin_users"
	| "app_shell.nav.admin_crews"
	| "app_shell.nav.admin_vans"
	| "app_shell.nav.admin_restock"
	| "app_shell.nav.installer"

export type NavItem = {
	to: string
	labelKey: NavLabelKey
	icon: IconSvgElement
	group: NavGroup
	roles?: Role[]
}

export const NAV_ITEMS: NavItem[] = [
	{
		to: "/dashboard",
		labelKey: "app_shell.nav.dashboard",
		icon: Home01Icon,
		group: "home",
	},
	{
		to: "/finance/queue",
		labelKey: "app_shell.nav.finance_queue",
		icon: Invoice02Icon,
		group: "finance",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/receivables",
		labelKey: "app_shell.nav.receivables",
		icon: MoneyExchange02Icon,
		group: "finance",
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/comptroller",
		labelKey: "app_shell.nav.comptroller",
		icon: Wallet01Icon,
		group: "finance",
		roles: ["COMPTROLLER", "ADMIN"],
	},
	{
		to: "/admin/restock",
		labelKey: "app_shell.nav.admin_restock",
		icon: PackageIcon,
		group: "field",
		roles: ["ADMIN"],
	},
	{
		to: "/installer",
		labelKey: "app_shell.nav.installer",
		icon: HardHatIcon,
		group: "field",
		roles: ["INSTALLER", "ADMIN"],
	},
	{
		to: "/admin/crews",
		labelKey: "app_shell.nav.admin_crews",
		icon: UserGroup03Icon,
		group: "field",
		roles: ["ADMIN"],
	},
	{
		to: "/admin/vans",
		labelKey: "app_shell.nav.admin_vans",
		icon: TruckDeliveryIcon,
		group: "field",
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
		to: "/admin/settings",
		labelKey: "app_shell.nav.admin_settings",
		icon: Settings02Icon,
		group: "admin",
		roles: ["ADMIN"],
	},
]

export const NAV_GROUP_ORDER: NavGroup[] = ["home", "finance", "field", "admin"]

export const NAV_GROUP_LABEL_KEY: Partial<
	Record<
		NavGroup,
		| "app_shell.nav.groups.finance"
		| "app_shell.nav.groups.field"
		| "app_shell.nav.groups.admin"
	>
> = {
	finance: "app_shell.nav.groups.finance",
	field: "app_shell.nav.groups.field",
	admin: "app_shell.nav.groups.admin",
}

export type NavCountVariant = "action" | "info"

/** Per-nav-path counts from loader (gap #47). Keys match NavItem.to. */
export type NavCounts = Partial<
	Record<string, { count: number; variant: NavCountVariant }>
>

export function canCreateDocument(role: Role) {
	return role === "SUPERVISOR" || role === "ADMIN"
}

export function filterNavItems(
	items: NavItem[],
	user: { role: Role },
	options: { comptrollerEnabled: boolean },
): NavItem[] {
	return items.filter((item) => {
		if (item.to.startsWith("/comptroller") && !options.comptrollerEnabled) {
			return false
		}
		return !item.roles || item.roles.includes(user.role)
	})
}

export function resolveActiveNavTo(
	pathname: string,
	items: NavItem[],
): string | undefined {
	return items
		.filter(
			(item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
		)
		.sort((a, b) => b.to.length - a.to.length)[0]?.to
}

export function groupNavItems(items: NavItem[]) {
	return NAV_GROUP_ORDER.map((group) => ({
		group,
		items: items.filter((item) => item.group === group),
	})).filter((entry) => entry.items.length > 0)
}

/** Stable nav paths for parity tests. */
export function visibleNavPaths(
	user: { role: Role },
	options: { comptrollerEnabled: boolean },
): string[] {
	return filterNavItems(NAV_ITEMS, user, options).map((item) => item.to)
}

export { FileAddIcon }
