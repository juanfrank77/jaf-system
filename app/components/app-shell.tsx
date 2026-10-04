import { Dialog } from "@base-ui/react/dialog"
import { Popover } from "@base-ui/react/popover"
import {
	Cancel01Icon,
	Menu01Icon,
	Notification01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TFunction } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useLocation } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { LanguageSwitcher } from "~/library/language-switcher"
import { ThemeToggle } from "~/library/theme-toggle"
import type { Role } from "../../generated/prisma/client"
import {
	GROUP_LABEL_KEY,
	type NavCount,
	type NavGroup,
	navGroupsFor,
	tabBarItemsFor,
} from "./nav-model"
import { OfflineIndicator } from "./offline-indicator"
import { TabBar } from "./tab-bar"
import { WarehouseSwitch } from "./warehouse-switch"

function initials(name: string) {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("")
}

function NavPill({ count }: { count?: NavCount }) {
	if (!count || count.value <= 0) return null
	return (
		<span
			data-testid="nav-pill"
			className={cn(
				"ml-auto rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums",
				count.tone === "critical"
					? "bg-status-danger-solid text-status-danger-solid-foreground"
					: "text-muted-foreground",
			)}
		>
			{count.value > 99 ? "99+" : count.value}
		</span>
	)
}

function NavList({
	groups,
	counts,
	onNavigate,
	"aria-label": ariaLabel,
}: {
	groups: NavGroup[]
	counts?: Record<string, NavCount>
	onNavigate?: () => void
	"aria-label": string
}) {
	const location = useLocation()
	const { t } = useTranslation()
	return (
		<nav aria-label={ariaLabel} className="flex flex-col gap-1">
			{groups.map((group) => {
				const labelKey = GROUP_LABEL_KEY[group.key]
				return (
					<div key={group.key} className="flex flex-col gap-1">
						{labelKey && (
							<p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
								{t(labelKey)}
							</p>
						)}
						{group.items.map((item) => {
							const active = location.pathname === item.to
							return (
								<Link
									key={item.to}
									to={item.to}
									onClick={onNavigate}
									className={cn(
										"flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-sm font-medium text-sidebar-foreground",
										active
											? "border-sidebar-border bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-card"
											: "border-transparent hover:bg-sidebar-accent/60",
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
									<NavPill count={counts?.[item.to]} />
								</Link>
							)
						})}
					</div>
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
					<span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-status-danger-solid text-[10px] text-status-danger-solid-foreground">
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
	warehouseScope,
	navCounts,
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
	warehouseScope?: {
		warehouses: { id: string; name: string }[]
		selectedId?: string
	}
	navCounts?: Record<string, NavCount>
	children: React.ReactNode
}) {
	const [drawerOpen, setDrawerOpen] = useState(false)
	const { t } = useTranslation()
	const groups = navGroupsFor(user.role, { comptrollerEnabled })
	const tabItems = tabBarItemsFor(user.role, { comptrollerEnabled })

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
					<Link to="/dashboard" className="font-bold tracking-tight">
						JAF Ops
					</Link>
					<div className="flex-1" />
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						<OfflineIndicator />
						{warehouseScope && (
							<WarehouseSwitch
								warehouses={warehouseScope.warehouses}
								selectedId={warehouseScope.selectedId}
							/>
						)}
						<span className="font-medium text-foreground">{user.name}</span>
						<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">
							{user.role}
						</span>
						<LanguageSwitcher />
						<NotificationBell notifications={notifications} />
						<ThemeToggle />
						<Form method="post" action="/sign-out">
							<Button type="submit" variant="ghost" size="sm">
								{t("app_shell.sign_out")}
							</Button>
						</Form>
					</div>
				</header>
				<div className="flex min-h-[calc(100vh-51px)]">
					<aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:block">
						<div className="mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
							<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
								{initials(user.name)}
							</span>
							<div className="text-sm font-semibold text-sidebar-foreground">
								{user.name}
							</div>
						</div>
						<NavList
							groups={groups}
							counts={navCounts}
							aria-label={t("app_shell.primary_nav")}
						/>
					</aside>
					<main
						className={cn(
							"mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8",
							tabItems.length > 0 && "pb-24 md:pb-6",
						)}
					>
						{children}
					</main>
				</div>
				<TabBar
					items={tabItems}
					aria-label={t("app_shell.primary_nav_mobile")}
				/>
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
						groups={groups}
						counts={navCounts}
						onNavigate={() => setDrawerOpen(false)}
						aria-label={t("app_shell.primary_nav_mobile")}
					/>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

export { AppShell }
