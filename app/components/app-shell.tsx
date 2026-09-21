import { Dialog } from "@base-ui/react/dialog"
import { Popover } from "@base-ui/react/popover"
import {
	Cancel01Icon,
	FileAddIcon,
	Logout01Icon,
	Menu01Icon,
	Notification01Icon,
	UnfoldMoreIcon,
	UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useLocation, useSubmit } from "react-router"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { Toaster, ToastViewport } from "~/components/ui/toast"
import {
	canCreateDocument,
	filterNavItems,
	groupNavItems,
	NAV_GROUP_LABEL_KEY,
	NAV_ITEMS,
	type NavItem,
	resolveActiveNavTo,
} from "~/lib/app-shell-nav"
import { formatRelativeTime } from "~/lib/format-relative-time"
import { cn } from "~/lib/utils"
import { LanguageSwitcher } from "~/library/language-switcher"
import type { Role } from "../../generated/prisma/client"
import { OfflineIndicator } from "./offline-indicator"

type AppUser = {
	id: string
	name: string
	role: Role
	image?: string | null
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
	const groups = groupNavItems(items)
	const activeTo = resolveActiveNavTo(location.pathname, items)

	return (
		<nav aria-label={ariaLabel} className="flex flex-col">
			{groups.map(({ group, items: groupItems }, index) => {
				const labelKey = NAV_GROUP_LABEL_KEY[group]
				return (
					<div
						key={group}
						className={cn(
							"flex flex-col gap-0.5",
							index > 0 && "mt-3.5 border-t border-sidebar-border pt-3.5",
						)}
					>
						{labelKey && (
							<div className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground select-none">
								{t(labelKey)}
							</div>
						)}
						{groupItems.map((item) => {
							const active = item.to === activeTo
							return (
								<Link
									key={item.to}
									to={item.to}
									onClick={onNavigate}
									aria-current={active ? "page" : undefined}
									className={cn(
										"group/nav relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
										active
											? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-r-full before:bg-sidebar-primary"
											: "font-normal text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
									)}
								>
									<HugeiconsIcon
										icon={item.icon}
										strokeWidth={active ? 2.25 : 1.75}
										className={cn(
											"size-[18px] shrink-0 transition-colors",
											active
												? "text-sidebar-accent-foreground"
												: "text-muted-foreground group-hover/nav:text-sidebar-foreground",
										)}
									/>
									<span className="truncate">{t(item.labelKey)}</span>
								</Link>
							)
						})}
					</div>
				)
			})}
		</nav>
	)
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
				className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label={t("app_shell.notifications.bell_label")}
			>
				<HugeiconsIcon
					icon={Notification01Icon}
					strokeWidth={2}
					className="size-5"
				/>
				{notifications.length > 0 && (
					<span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-status-danger text-[10px] text-white">
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

function UserMenu({ user }: { user: AppUser }) {
	const { t } = useTranslation()
	const submit = useSubmit()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="group/user flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/50 data-popup-open:bg-sidebar-accent/60"
				aria-label={t("app_shell.user_menu.trigger_label")}
			>
				<Avatar
					name={user.name}
					src={user.image ? `/avatars/${user.id}` : null}
					className="ring-1 ring-sidebar-border"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-sidebar-foreground">
						{user.name}
					</span>
					<span className="block truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						{user.role}
					</span>
				</span>
				<HugeiconsIcon
					icon={UnfoldMoreIcon}
					strokeWidth={2}
					className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/user:text-sidebar-foreground"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="w-52">
				<DropdownMenuItem render={<Link to="/account" />}>
					<HugeiconsIcon icon={UserIcon} strokeWidth={2} className="size-4" />
					{t("app_shell.user_menu.profile_link")}
				</DropdownMenuItem>
				<DropdownMenuItem
					variant="destructive"
					onClick={() => submit(null, { method: "post", action: "/sign-out" })}
				>
					<HugeiconsIcon
						icon={Logout01Icon}
						strokeWidth={2}
						className="size-4"
					/>
					{t("app_shell.sign_out")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function SidebarContent({
	items,
	user,
	createDoc,
	onNavigate,
	navLabel,
}: {
	items: NavItem[]
	user: AppUser
	createDoc: boolean
	onNavigate?: () => void
	navLabel: string
}) {
	const { t } = useTranslation()
	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			{createDoc && (
				<Button
					render={<Link to="/docs/new" onClick={onNavigate} />}
					nativeButton={false}
					role="link"
					className="mb-4 w-full shadow-xs"
				>
					<HugeiconsIcon
						icon={FileAddIcon}
						strokeWidth={2}
						className="size-4"
						data-icon="inline-start"
					/>
					{t("app_shell.nav.new_document")}
				</Button>
			)}
			<div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
				<NavList items={items} onNavigate={onNavigate} aria-label={navLabel} />
			</div>
			<div className="-mx-3 mt-2 border-t border-sidebar-border px-2 pt-2">
				<UserMenu user={user} />
			</div>
		</div>
	)
}

function AppShell({
	user,
	notifications,
	comptrollerEnabled,
	children,
}: {
	user: AppUser
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
	const createDoc = canCreateDocument(user.role)
	const items = filterNavItems(NAV_ITEMS, user, {
		comptrollerEnabled: comptrollerEnabled ?? false,
	})

	return (
		<Toaster>
			<Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
				<div className="min-h-screen bg-background">
					<header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-border bg-card px-4 py-2.5 sm:px-5">
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
						<Link to="/dashboard" className="flex items-center">
							<img
								src="/JAFCO-logo-cropped.png"
								alt="JAF Communication"
								className="h-8 w-auto"
							/>
						</Link>
						<div className="flex-1" />
						<div className="flex items-center gap-1.5">
							<OfflineIndicator />
							<LanguageSwitcher />
							<NotificationBell notifications={notifications} />
						</div>
					</header>
					<div className="flex min-h-[calc(100vh-53px)]">
						<aside className="sticky top-[53px] hidden h-[calc(100vh-53px)] w-60 shrink-0 self-start border-r border-sidebar-border bg-sidebar p-3 md:flex">
							<SidebarContent
								items={items}
								user={user}
								createDoc={createDoc}
								navLabel={t("app_shell.primary_nav")}
							/>
						</aside>
						<main className="w-full min-w-0 max-w-[1600px] flex-1 px-4 py-6 sm:px-5 md:px-8">
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
						<div className="mb-1 flex items-center justify-end">
							<Dialog.Close
								aria-label={t("app_shell.close_menu")}
								className="flex size-8 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
							>
								<HugeiconsIcon
									icon={Cancel01Icon}
									strokeWidth={2}
									className="size-4"
								/>
							</Dialog.Close>
						</div>
						<SidebarContent
							items={items}
							user={user}
							createDoc={createDoc}
							onNavigate={() => setDrawerOpen(false)}
							navLabel={t("app_shell.primary_nav_mobile")}
						/>
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
			<ToastViewport />
		</Toaster>
	)
}

export { AppShell }
