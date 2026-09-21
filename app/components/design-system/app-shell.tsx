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
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useLocation, useSubmit } from "react-router"
import { Toaster, ToastViewport } from "~/components/ui/toast"
import {
	canCreateDocument,
	filterNavItems,
	groupNavItems,
	NAV_GROUP_LABEL_KEY,
	NAV_ITEMS,
	type NavCounts,
	FileAddIcon as NavFileAddIcon,
	type NavItem,
	resolveActiveNavTo,
} from "~/lib/app-shell-nav"
import { formatRelativeTime } from "~/lib/format-relative-time"
import type { Theme } from "~/lib/theme.server"
import type { Role } from "../../../generated/prisma/client"
import { CountBadge } from "./count-badge"
import { DesignSystem } from "./primitives"
import {
	DsLanguageToggle,
	DsOfflineIndicator,
	DsThemeToggle,
} from "./shell-controls"

type AppUser = {
	id: string
	name: string
	role: Role
	image?: string | null
}

type ShellNotification = {
	id: string
	message: string
	docId: string | null
	createdAt: Date
}

function userInitials(name: string) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("")
}

function ShellNavLinks({
	items,
	navCounts,
	onNavigate,
	activeTo,
}: {
	items: NavItem[]
	navCounts: NavCounts
	onNavigate?: () => void
	activeTo?: string
}) {
	const { t } = useTranslation()
	const groups = groupNavItems(items)

	return (
		<>
			{groups.map(({ group, items: groupItems }) => {
				const labelKey = NAV_GROUP_LABEL_KEY[group]
				return (
					<div key={group}>
						{labelKey ? <div className="jaf-grp">{t(labelKey)}</div> : null}
						{groupItems.map((item) => {
							const active = item.to === activeTo
							const count = navCounts[item.to]
							return (
								<Link
									key={item.to}
									to={item.to}
									onClick={onNavigate}
									className={active ? "jaf-on" : undefined}
									aria-current={active ? "page" : undefined}
								>
									<span>{t(item.labelKey)}</span>
									{count ? (
										<CountBadge count={count.count} variant={count.variant} />
									) : null}
								</Link>
							)
						})}
					</div>
				)
			})}
		</>
	)
}

function ShellNotifications({
	notifications,
}: {
	notifications: ShellNotification[]
}) {
	const { t } = useTranslation()
	const location = useLocation()
	const redirectTo = `${location.pathname}${location.search}`
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			queueMicrotask(() => triggerRef.current?.focus())
		}
	}

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
			<Popover.Trigger
				ref={triggerRef}
				className="jaf-btn jaf-ghost"
				style={{ minHeight: 44, minWidth: 44, position: "relative" }}
				aria-label={t("app_shell.notifications.bell_label")}
			>
				<HugeiconsIcon
					icon={Notification01Icon}
					strokeWidth={2}
					className="size-5"
				/>
				{notifications.length > 0 ? (
					<span
						className="jaf-pill"
						style={{ position: "absolute", top: 4, right: 4 }}
					>
						{notifications.length}
					</span>
				) : null}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner align="end" sideOffset={8} className="z-40">
					<Popover.Popup
						className="jaf-box"
						style={{ width: 320, padding: 12 }}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: 8,
							}}
						>
							<span style={{ fontWeight: 600 }}>
								{t("app_shell.notifications.title")}
							</span>
							{notifications.length > 0 ? (
								<Form method="post" action="/notifications/mark-all-read">
									<input type="hidden" name="redirectTo" value={redirectTo} />
									<button type="submit" className="jaf-btn jaf-ghost jaf-sm">
										{t("app_shell.notifications.mark_all_read")}
									</button>
								</Form>
							) : null}
						</div>
						{notifications.length === 0 ? (
							<p className="jaf-sub">{t("app_shell.notifications.empty")}</p>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
												className="jaf-btn jaf-ghost"
												style={{
													width: "100%",
													textAlign: "left",
													whiteSpace: "normal",
													minHeight: 44,
												}}
												onClick={() => setOpen(false)}
											>
												<span>{notification.message}</span>
												<span className="jaf-sub" aria-hidden="true">
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

function ShellUserMenu({ user }: { user: AppUser }) {
	const { t } = useTranslation()
	const submit = useSubmit()
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			queueMicrotask(() => triggerRef.current?.focus())
		}
	}

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
			<Popover.Trigger
				ref={triggerRef}
				className="jaf-user"
				style={{
					width: "100%",
					border: 0,
					background: "transparent",
					cursor: "pointer",
					minHeight: 44,
				}}
				aria-label={t("app_shell.user_menu.trigger_label")}
			>
				<div className="jaf-av">{userInitials(user.name)}</div>
				<div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
					<div className="jaf-nm">{user.name}</div>
					<div className="jaf-rl">{user.role}</div>
				</div>
				<HugeiconsIcon
					icon={UnfoldMoreIcon}
					strokeWidth={2}
					className="size-4"
				/>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					side="top"
					align="start"
					sideOffset={8}
					className="z-40"
				>
					<Popover.Popup className="jaf-box" style={{ width: 220, padding: 8 }}>
						<Link
							to="/account"
							className="jaf-btn jaf-ghost"
							style={{
								width: "100%",
								minHeight: 44,
								justifyContent: "flex-start",
							}}
							onClick={() => setOpen(false)}
						>
							<HugeiconsIcon
								icon={UserIcon}
								strokeWidth={2}
								className="size-4"
							/>
							{t("app_shell.user_menu.profile_link")}
						</Link>
						<button
							type="button"
							className="jaf-btn jaf-ghost"
							style={{
								width: "100%",
								minHeight: 44,
								justifyContent: "flex-start",
								color: "var(--critical)",
							}}
							onClick={() =>
								submit(null, { method: "post", action: "/sign-out" })
							}
						>
							<HugeiconsIcon
								icon={Logout01Icon}
								strokeWidth={2}
								className="size-4"
							/>
							{t("app_shell.sign_out")}
						</button>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

function ShellRail({
	items,
	user,
	navCounts,
	activeTo,
	theme,
}: {
	items: NavItem[]
	user: AppUser
	navCounts: NavCounts
	activeTo?: string
	theme: Theme
}) {
	const { t } = useTranslation()
	const createDoc = canCreateDocument(user.role)

	return (
		<aside className="jaf-rail">
			<Link to="/dashboard" className="jaf-wordmark">
				JAF Ops
				<span>{t("ds.shell.wordmark_sub")}</span>
			</Link>
			{createDoc ? (
				<Link
					to="/docs/new"
					className="jaf-btn jaf-blue"
					style={{ minHeight: 44 }}
				>
					<HugeiconsIcon
						icon={NavFileAddIcon}
						strokeWidth={2}
						className="size-4"
					/>
					{t("app_shell.nav.new_document")}
				</Link>
			) : null}
			<nav aria-label={t("app_shell.primary_nav")}>
				<ShellNavLinks
					items={items}
					navCounts={navCounts}
					activeTo={activeTo}
				/>
			</nav>
			<div className="jaf-foot">
				<ShellUserMenu user={user} />
				<div className="jaf-toggles">
					<DsThemeToggle theme={theme} />
					<DsLanguageToggle />
				</div>
			</div>
		</aside>
	)
}

export function DesignSystemAppShell({
	user,
	notifications,
	navCounts = {},
	comptrollerEnabled,
	theme,
	children,
}: {
	user: AppUser
	notifications: ShellNotification[]
	navCounts?: NavCounts
	comptrollerEnabled?: boolean
	theme: Theme
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	const location = useLocation()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const menuButtonRef = useRef<HTMLButtonElement>(null)
	const drawerRef = useRef<HTMLDialogElement>(null)
	const drawerTitleId = useId()
	const items = filterNavItems(NAV_ITEMS, user, {
		comptrollerEnabled: comptrollerEnabled ?? false,
	})
	const activeTo = resolveActiveNavTo(location.pathname, items)

	useEffect(() => {
		const dialog = drawerRef.current
		if (!dialog) return
		if (drawerOpen && !dialog.open) {
			dialog.showModal()
			const first = dialog.querySelector<HTMLElement>(
				"a[href], button:not([disabled])",
			)
			first?.focus()
		}
		if (!drawerOpen && dialog.open) {
			dialog.close()
		}
	}, [drawerOpen])

	useEffect(() => {
		const dialog = drawerRef.current
		if (!dialog) return
		const onClose = () => {
			setDrawerOpen(false)
			menuButtonRef.current?.focus()
		}
		dialog.addEventListener("close", onClose)
		return () => dialog.removeEventListener("close", onClose)
	}, [])

	return (
		<DesignSystem>
			<Toaster>
				<a href="#main-content" className="jaf-skip">
					{t("ds.shell.skip_to_content")}
				</a>
				<div className="jaf-shell">
					<ShellRail
						items={items}
						user={user}
						navCounts={navCounts}
						activeTo={activeTo}
						theme={theme}
					/>
					<div className="jaf-wrap jaf-wide">
						<header className="jaf-top">
							<button
								ref={menuButtonRef}
								type="button"
								className="jaf-btn jaf-ghost jaf-menu-btn"
								style={{ minHeight: 44, minWidth: 44 }}
								aria-label={t("app_shell.open_menu")}
								aria-expanded={drawerOpen}
								aria-controls="ds-nav-drawer"
								onClick={() => setDrawerOpen(true)}
							>
								<HugeiconsIcon
									icon={Menu01Icon}
									strokeWidth={2}
									className="size-5"
								/>
							</button>
							<Link to="/dashboard" className="jaf-wordmark jaf-top-mark">
								<img
									src="/JAFCO-logo-cropped.png"
									alt="JAF Communication"
									style={{ height: 32, width: "auto" }}
								/>
							</Link>
							<div className="jaf-spacer" />
							<div
								className="jaf-actions"
								style={{ alignItems: "center", flexWrap: "wrap" }}
							>
								<DsOfflineIndicator />
								<div className="jaf-top-lang">
									<DsLanguageToggle />
								</div>
								<ShellNotifications notifications={notifications} />
							</div>
						</header>
						<main id="main-content">{children}</main>
					</div>
				</div>
				<dialog
					ref={drawerRef}
					id="ds-nav-drawer"
					className="jaf-drawer"
					aria-labelledby={drawerTitleId}
					onCancel={(event) => {
						event.preventDefault()
						setDrawerOpen(false)
					}}
				>
					<div className="jaf-drawer-head">
						<h2 id={drawerTitleId} className="jaf-wordmark">
							{t("app_shell.navigation_dialog")}
						</h2>
						<button
							type="button"
							className="jaf-btn jaf-ghost"
							style={{ minHeight: 44, minWidth: 44 }}
							aria-label={t("app_shell.close_menu")}
							onClick={() => setDrawerOpen(false)}
						>
							<HugeiconsIcon
								icon={Cancel01Icon}
								strokeWidth={2}
								className="size-4"
							/>
						</button>
					</div>
					{canCreateDocument(user.role) ? (
						<Link
							to="/docs/new"
							className="jaf-btn jaf-blue"
							style={{ minHeight: 44, marginBottom: 12 }}
							onClick={() => setDrawerOpen(false)}
						>
							<HugeiconsIcon
								icon={FileAddIcon}
								strokeWidth={2}
								className="size-4"
							/>
							{t("app_shell.nav.new_document")}
						</Link>
					) : null}
					<nav aria-label={t("app_shell.primary_nav_mobile")}>
						<ShellNavLinks
							items={items}
							navCounts={navCounts}
							activeTo={activeTo}
							onNavigate={() => setDrawerOpen(false)}
						/>
					</nav>
					<div className="jaf-foot">
						<ShellUserMenu user={user} />
						<div className="jaf-toggles">
							<DsThemeToggle theme={theme} />
							<DsLanguageToggle />
						</div>
					</div>
				</dialog>
				<ToastViewport />
			</Toaster>
		</DesignSystem>
	)
}
