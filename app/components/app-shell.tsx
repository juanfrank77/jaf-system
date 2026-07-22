import { Form, Link, useLocation } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import type { Role } from "../../generated/prisma/client"

type NavItem = { to: string; label: string; roles?: Role[] }

const NAV_ITEMS: NavItem[] = [
	{ to: "/dashboard", label: "Dashboard" },
	{ to: "/docs/new", label: "+ New Document", roles: ["SUPERVISOR", "ADMIN"] },
	{
		to: "/finance/receivables",
		label: "Receivables",
		roles: ["FINANCE", "ADMIN"],
	},
	{ to: "/admin/settings", label: "Admin Settings", roles: ["ADMIN"] },
	{ to: "/admin/catalog", label: "Catalog", roles: ["ADMIN"] },
]

function initials(name: string) {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("")
}

function AppShell({
	user,
	notifications,
	children,
}: {
	user: { name: string; role: Role }
	notifications: { id: string }[]
	children: React.ReactNode
}) {
	const location = useLocation()
	const items = NAV_ITEMS.filter(
		(item) => !item.roles || item.roles.includes(user.role),
	)

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-border bg-card px-4.5 py-2.5">
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
					<span className="font-medium text-foreground">{user.name}</span>
					<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">
						{user.role}
					</span>
					<button type="button" className="relative text-muted-foreground">
						🔔
						{notifications.length > 0 && (
							<span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-status-danger text-[10px] text-white">
								{notifications.length}
							</span>
						)}
					</button>
					<Form method="post" action="/api/auth/sign-out">
						<Button type="submit" variant="ghost" size="sm">
							Sign out
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
					<nav className="flex flex-col gap-1">
						{items.map((item) => {
							const active = location.pathname === item.to
							return (
								<Link
									key={item.to}
									to={item.to}
									className={cn(
										"rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground",
										active
											? "bg-sidebar-accent text-sidebar-accent-foreground"
											: "hover:bg-sidebar-accent/60",
									)}
								>
									{item.label}
								</Link>
							)
						})}
					</nav>
				</aside>
				<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
					{children}
				</main>
			</div>
		</div>
	)
}

export { AppShell }
