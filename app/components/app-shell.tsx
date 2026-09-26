import { Dialog } from "@base-ui/react/dialog"
import { Popover } from "@base-ui/react/popover"
import {
	Cancel01Icon,
	DashboardSquare01Icon,
	FileAddIcon,
	GridViewIcon,
	Invoice02Icon,
	Menu01Icon,
	Notification01Icon,
	Settings02Icon,
	TruckDeliveryIcon,
	UserGroup03Icon,
	UserIcon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { TFunction } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useLocation } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { LanguageSwitcher } from "~/library/language-switcher"
import type { Role } from "../../generated/prisma/client"
import { OfflineIndicator } from "./offline-indicator"

type NavItem = {
	to: string
	labelKey:
		| "app_shell.nav.dashboard"
		| "app_shell.nav.new_document"
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
		| "app_shell.nav.installer_supervisor"
	icon: IconSvgElement
	roles?: Role[]
}

const NAV_ITEMS: NavItem[] = [
	{
		to: "/dashboard",
		labelKey: "app_shell.nav.dashboard",
		icon: DashboardSquare01Icon,
	},
	{
		to: "/docs/new",
		labelKey: "app_shell.nav.new_document",
		icon: FileAddIcon,
		roles: ["SUPERVISOR", "ADMIN"],
	},
	{
		to: "/finance/queue",
		labelKey: "app_shell.nav.finance_queue",
		icon: Invoice02Icon,
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/finance/receivables",
		labelKey: "app_shell.nav.receivables",
		icon: Invoice02Icon,
		roles: ["FINANCE", "ADMIN"],
	},
	{
		to: "/admin/settings",
		labelKey: "app_shell.nav.admin_settings",
		icon: Settings02Icon,
		roles: ["ADMIN"],
	},
	{
		to: "/admin/catalog",
		labelKey: "app_shell.nav.catalog",
		icon: GridViewIcon,
		roles: ["ADMIN"],
	},
	{
		to: "/admin/users",
		labelKey: "app_shell.nav.admin_users",
		icon: UserIcon,
		roles: ["ADMIN"],
	},
	{
		to: "/admin/crews",
		labelKey: "app_shell.nav.admin_crews",
		icon: UserGroup03Icon,
		roles: ["ADMIN"],
	},
	{
		to: "/admin/vans",
		labelKey: "app_shell.nav.admin_vans",
		icon: TruckDeliveryIcon,
		roles: ["ADMIN"],
	},
	{
		to: "/installer",
		labelKey: "app_shell.nav.installer",
		icon: TruckDeliveryIcon,
		roles: ["INSTALLER", "ADMIN"],
	},
	{
		to: "/installer-supervisor",
		labelKey: "app_shell.nav.installer_supervisor",
		icon: TruckDeliveryIcon,
		roles: ["INSTALLER_SUPERVISOR", "ADMIN"],
	},
	{
		to: "/comptroller",
		labelKey: "app_shell.nav.comptroller",
		icon: Wallet01Icon,
		roles: ["COMPTROLLER", "ADMIN"],
	},
]

function initials(name: string) {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("")
}

function NavList({
	items,
	onNavigate,
	"aria-label": ariaLabel,
}: {
	items: NavItem[]
	onNavigate?: () => void
	"aria-label": string
}) {
	const location = useLocation()
	const { t } = useTranslation()
	return (
		<nav aria-label={ariaLabel} className="flex flex-col gap-1">
			{items.map((item) => {
				const active = location.pathname === item.to
				return (
					<Link
						key={item.to}
						to={item.to}
						onClick={onNavigate}
						className={cn(
							"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground",
							active
								? "bg-sidebar-accent text-sidebar-accent-foreground"
								: "hover:bg-sidebar-accent/60",
						)}
					>
						<HugeiconsIcon
							icon={item.icon}
							strokeWidth={2}
							className={cn(
								"size-4 shrink-0",
								!active && "text-muted-foreground",
							)}
						/>
						{t(item.labelKey)}
					</Link>
				)
			})}
		</nav>
	)
}

function formatRelativeTime(date: Date, t: TFunction) {
	const diffMs = Date.now() - date.getTime()
	const diffMinutes = Math.round(diffMs / 60000)
	if (diffMinutes < 1) return t("app_shell.notifications.time.just_now")
	if (diffMinutes < 60)
		return t("app_shell.notifications.time.minutes_ago", {
			count: diffMinutes,
		})
	const diffHours = Math.round(diffMinutes / 60)
	if (diffHours < 24)
		return t("app_shell.notifications.time.hours_ago", { count: diffHours })
	const diffDays = Math.round(diffHours / 24)
	return t("app_shell.notifications.time.days_ago", { count: diffDays })
}

function NotificationBell({
	notifications,
}: {
	notifications: {
		id: string
		message: string
		docId: string | null
		createdAt: Date
	}[]
}) {
	const { t } = useTranslation()
	const location = useLocation()
	const redirectTo = `${location.pathname}${location.search}`
	const [notificationsOpen, setNotificationsOpen] = useState(false)

	return (
		<Popover.Root open={notificationsOpen} onOpenChange={setNotificationsOpen}>
			<Popover.Trigger
				className="relative text-muted-foreground"
				aria-label={t("app_shell.notifications.bell_label")}
			>
				<HugeiconsIcon
					icon={Notification01Icon}
					strokeWidth={2}
					className="size-5"
				/>
				{notifications.length > 0 && (
					<span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-status-danger text-[10px] text-white">
						{notifications.length}
					</span>
				)}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner align="end" sideOffset={8} className="z-40">
					<Popover.Popup className="w-80 rounded-lg border border-border bg-card p-2 shadow-lg outline-none">
						<div className="flex items-center justify-between px-2 py-1.5">
							<span className="text-sm font-semibold text-foreground">
								{t("app_shell.notifications.title")}
							</span>
							{notifications.length > 0 && (
								<Form method="post" action="/notifications/mark-all-read">
									<input type="hidden" name="redirectTo" value={redirectTo} />
									<button
										type="submit"
										className="text-xs font-medium text-primary hover:underline"
									>
										{t("app_shell.notifications.mark_all_read")}
									</button>
								</Form>
							)}
						</div>
						{notifications.length === 0 ? (
							<p className="px-2 py-3 text-sm text-muted-foreground">
								{t("app_shell.notifications.empty")}
							</p>
						) : (
							<ul className="flex flex-col">
								{notifications.map((notification) => (
									<li key={notification.id}>
										<Form
											method="post"
											action={`/notifications/${notification.id}/read`}
										>
											<input
												type="hidden"
												name="redirectTo"
												value={redirectTo}
											/>
											<button
												type="submit"
												onClick={() => setNotificationsOpen(false)}
												className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
											>
												<span className="block text-foreground">
													{notification.message}
												</span>
												<span
													aria-hidden="true"
													className="block text-xs text-muted-foreground"
												>
													{formatRelativeTime(notification.createdAt, t)}
												</span>
											</button>
										</Form>
									</li>
								))}
							</ul>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

function AppShell({
	user,
	notifications,
	comptrollerEnabled,
	children,
}: {
	user: { name: string; role: Role }
	notifications: {
		id: string
		message: string
		docId: string | null
		createdAt: Date
	}[]
	comptrollerEnabled?: boolean
	children: React.ReactNode
}) {
	const [drawerOpen, setDrawerOpen] = useState(false)
	const { t } = useTranslation()
	const items = NAV_ITEMS.filter((item) => {
		if (item.to.startsWith("/comptroller") && !comptrollerEnabled) return false
		return !item.roles || item.roles.includes(user.role)
	})

	return (
		<Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
			<div className="min-h-screen bg-background">
				<header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-border bg-card px-4.5 py-2.5">
					<Dialog.Trigger
						className="-ml-1.5 flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
						aria-label={t("app_shell.open_menu")}
					>
						<HugeiconsIcon
							icon={Menu01Icon}
							strokeWidth={2}
							className="size-5"
						/>
					</Dialog.Trigger>
					<Link
						to="/dashboard"
						className="flex items-center gap-2 font-bold tracking-tight"
					>
						<span className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">
							J
						</span>
						JAF Ops
					</Link>
					<div className="flex-1" />
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						<OfflineIndicator />
						<span className="font-medium text-foreground">{user.name}</span>
						<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">
							{user.role}
						</span>
						<LanguageSwitcher />
						<NotificationBell notifications={notifications} />
						<Form method="post" action="/sign-out">
							<Button type="submit" variant="ghost" size="sm">
								{t("app_shell.sign_out")}
							</Button>
						</Form>
					</div>
				</header>
				<div className="flex min-h-[calc(100vh-51px)]">
					<aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:block">
						<div className="mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
							<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
								{initials(user.name)}
							</span>
							<div className="text-sm font-semibold text-sidebar-foreground">
								{user.name}
							</div>
						</div>
						<NavList items={items} aria-label={t("app_shell.primary_nav")} />
					</aside>
					<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
						{children}
					</main>
				</div>
			</div>
			<Dialog.Portal>
				<Dialog.Backdrop
					data-testid="nav-drawer-backdrop"
					className="fixed inset-0 z-40 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
				/>
				<Dialog.Popup
					aria-label={t("app_shell.navigation_dialog")}
					className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar p-3 shadow-xl outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
				>
					<div className="mb-2 flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2">
						<div className="flex items-center gap-2.5">
							<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
								{initials(user.name)}
							</span>
							<div className="text-sm font-semibold text-sidebar-foreground">
								{user.name}
							</div>
						</div>
						<Dialog.Close
							aria-label={t("app_shell.close_menu")}
							className="flex size-8 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/60"
						>
							<HugeiconsIcon
								icon={Cancel01Icon}
								strokeWidth={2}
								className="size-4"
							/>
						</Dialog.Close>
					</div>
					<NavList
						items={items}
						onNavigate={() => setDrawerOpen(false)}
						aria-label={t("app_shell.primary_nav_mobile")}
					/>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

export { AppShell }
