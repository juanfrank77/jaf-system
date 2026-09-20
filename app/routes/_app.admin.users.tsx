import {
	MoreHorizontalIcon,
	PlusSignIcon,
	Search01Icon,
	UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { hashPassword } from "better-auth/crypto"
import type { ParseKeys } from "i18next"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Drawer, DrawerContent } from "~/components/ui/drawer"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableRow,
	TableToolbar,
} from "~/components/ui/table"
import { useToastManager } from "~/components/ui/toast"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Role } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.admin.users"

type UserRow = {
	id: string
	name: string
	email: string
	role: string
	active: boolean
}

const ROLES: { value: string; labelKey: string }[] = [
	{ value: "SUPERVISOR", labelKey: "admin_users.role.supervisor" },
	{ value: "WAREHOUSE", labelKey: "admin_users.role.warehouse" },
	{ value: "CREW", labelKey: "admin_users.role.crew" },
	{ value: "INSTALLER", labelKey: "admin_users.role.installer" },
	{ value: "FINANCE", labelKey: "admin_users.role.finance" },
	{ value: "COMPTROLLER", labelKey: "admin_users.role.comptroller" },
	{ value: "ADMIN", labelKey: "admin_users.role.admin" },
]

export const meta: Route.MetaFunction = () => [{ title: "Users — JAF Ops" }]

function validateEmail(email: unknown): email is string {
	return (
		typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
	)
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const users = await db.user.findMany({
		orderBy: { name: "asc" },
		take: 200,
	})

	return { users, roles: ROLES }
}

export async function action({ request }: Route.ActionArgs) {
	const { user: admin } = await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create") {
		const name = form.get("name")
		const email = form.get("email")
		const role = form.get("role")
		const tempPassword = form.get("tempPassword")

		if (
			typeof name !== "string" ||
			!name.trim() ||
			!validateEmail(email) ||
			typeof role !== "string" ||
			!ROLES.some((r) => r.value === role) ||
			typeof tempPassword !== "string" ||
			tempPassword.length < 8
		) {
			return data(
				{ errorKey: "admin_users.errors.create_invalid" },
				{ status: 400 },
			)
		}

		const existing = await db.user.findUnique({
			where: { email: email.trim() },
		})
		if (existing) {
			return data(
				{ errorKey: "admin_users.errors.email_exists" },
				{ status: 409 },
			)
		}

		const passwordHash = await hashPassword(tempPassword)
		await db.$transaction(async (tx) => {
			const newUser = await tx.user.create({
				data: {
					email: email.trim(),
					name: name.trim(),
					role: role as Role,
				},
			})
			await tx.account.create({
				data: {
					id: `admin-${newUser.email}`,
					userId: newUser.id,
					accountId: newUser.id,
					providerId: "credential",
					password: passwordHash,
				},
			})
		})

		return redirect("/admin/users")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_users.errors.id_required" },
				{ status: 400 },
			)
		}
		if (id === admin.id) {
			return data(
				{ errorKey: "admin_users.errors.cannot_deactivate_self" },
				{ status: 400 },
			)
		}
		const existing = await db.user.findUniqueOrThrow({ where: { id } })
		await db.user.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/users")
	}

	if (intent === "resetPassword") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_users.errors.id_required" },
				{ status: 400 },
			)
		}
		const tempPassword = crypto.randomUUID().slice(0, 12)
		const passwordHash = await hashPassword(tempPassword)
		const account = await db.account.findFirst({ where: { userId: id } })
		if (!account) {
			return data(
				{ errorKey: "admin_users.errors.no_account" },
				{ status: 404 },
			)
		}
		await db.account.update({
			where: { id: account.id },
			data: { password: passwordHash },
		})
		return { resetSuccess: true }
	}

	if (intent === "updateRole") {
		const id = form.get("id")
		const role = form.get("role")
		if (
			typeof id !== "string" ||
			!id.trim() ||
			typeof role !== "string" ||
			!ROLES.some((r) => r.value === role)
		) {
			return data(
				{ errorKey: "admin_users.errors.update_invalid" },
				{ status: 400 },
			)
		}
		if (id === admin.id) {
			return data(
				{ errorKey: "admin_users.errors.cannot_change_own_role" },
				{ status: 400 },
			)
		}
		await db.user.update({
			where: { id },
			data: { role: role as Role },
		})
		return redirect("/admin/users")
	}

	return data(
		{ errorKey: "admin_users.errors.unknown_intent" },
		{ status: 400 },
	)
}

function RoleSelect({ user, roles }: { user: UserRow; roles: typeof ROLES }) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ errorKey?: string } | null>()
	const toastManager = useToastManager()

	useEffect(() => {
		if (fetcher.data && "errorKey" in fetcher.data && fetcher.data.errorKey) {
			toastManager.add({
				title: t(fetcher.data.errorKey as ParseKeys),
			})
		}
	}, [fetcher.data, t, toastManager])

	return (
		<Select
			defaultValue={user.role}
			onValueChange={(value) => {
				if (!value) return
				const fd = new FormData()
				fd.set("intent", "updateRole")
				fd.set("id", user.id)
				fd.set("role", value)
				fetcher.submit(fd, { method: "post" })
			}}
		>
			<SelectTrigger size="sm" className="w-32">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{roles.map((r) => (
					<SelectItem key={r.value} value={r.value}>
						{t(r.labelKey as ParseKeys)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

export default function AdminUsers({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { users, roles } = loaderData as {
		users: UserRow[]
		roles: typeof ROLES
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const resetSuccess =
		actionData && "resetSuccess" in actionData
			? (actionData.resetSuccess as boolean)
			: false
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "inactive"
	>("all")
	const [roleFilter, setRoleFilter] = useState("all")
	const createFetcher = useFetcher<{ errorKey?: string } | null>()
	const wasCreating = useRef(false)
	const creating = createFetcher.state !== "idle"
	const createError =
		createFetcher.data && "errorKey" in createFetcher.data
			? createFetcher.data.errorKey
			: null

	useEffect(() => {
		if (wasCreating.current && !creating && !createError) setDrawerOpen(false)
		wasCreating.current = creating
	}, [creating, createError])

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return users.filter((user) => {
			if (statusFilter === "active" && !user.active) return false
			if (statusFilter === "inactive" && user.active) return false
			if (roleFilter !== "all" && user.role !== roleFilter) return false
			if (!term) return true
			return (
				user.name.toLowerCase().includes(term) ||
				user.email.toLowerCase().includes(term)
			)
		})
	}, [users, search, statusFilter, roleFilter])

	return (
		<div>
			<PageHeader
				title={t("admin_users.title")}
				subtitle={t("admin_users.subtitle")}
				actions={
					<Button onClick={() => setDrawerOpen(true)}>
						<HugeiconsIcon
							icon={PlusSignIcon}
							strokeWidth={2}
							className="size-4"
						/>
						{t("admin_users.add_submit")}
					</Button>
				}
			/>

			{error && (
				<p className="mb-4 rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
					{t(error as ParseKeys)}
				</p>
			)}

			{resetSuccess && (
				<div className="mb-4 rounded-md border border-status-warn/20 bg-status-warn-soft px-4 py-3 text-sm text-status-warn">
					<p className="font-medium">
						{t("admin_users.reset_password_notice")}
					</p>
					<p className="mt-1">{t("admin_users.reset_password_detail")}</p>
				</div>
			)}

			<Card>
				<TableToolbar>
					<Input
						leading={
							<HugeiconsIcon
								icon={Search01Icon}
								strokeWidth={2}
								className="size-4"
							/>
						}
						placeholder={t("admin_users.search_placeholder")}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="sm:w-64"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{t("admin_users.result_count", { count: filtered.length })}
						</span>
						<Select
							value={roleFilter}
							onValueChange={(value) => setRoleFilter(value ?? "all")}
						>
							<SelectTrigger size="sm" aria-label={t("admin_users.table.role")}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_users.filter_all_roles")}
								</SelectItem>
								{roles.map((role) => (
									<SelectItem key={role.value} value={role.value}>
										{t(role.labelKey as ParseKeys)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={statusFilter}
							onValueChange={(value) =>
								setStatusFilter(value as typeof statusFilter)
							}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("admin_users.table.active")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_users.filter_all")}
								</SelectItem>
								<SelectItem value="active">
									{t("admin_users.filter_active")}
								</SelectItem>
								<SelectItem value="inactive">
									{t("admin_users.filter_inactive")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</TableToolbar>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("admin_users.table.name")}</TableHead>
							<TableHead>{t("admin_users.table.email")}</TableHead>
							<TableHead>{t("admin_users.table.role")}</TableHead>
							<TableHead>{t("admin_users.table.active")}</TableHead>
							<TableHead className="text-right">
								{t("admin_users.table.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map((user) => (
							<TableRow key={user.id} data-inactive={!user.active || undefined}>
								<TableCell>{user.name}</TableCell>
								<TableCell className="text-muted-foreground">
									{user.email}
								</TableCell>
								<TableCell>
									<RoleSelect user={user} roles={roles} />
								</TableCell>
								<TableCell>
									<Badge variant={user.active ? "ok" : "neutral"} dot>
										{user.active
											? t("admin_users.status_active")
											: t("admin_users.status_inactive")}
									</Badge>
								</TableCell>
								<TableCell className="text-right">
									<DropdownMenu>
										<DropdownMenuTrigger
											aria-label={t("admin_users.row_menu")}
											className={buttonVariants({
												variant: "ghost",
												size: "icon-sm",
											})}
										>
											<HugeiconsIcon
												icon={MoreHorizontalIcon}
												strokeWidth={2}
												className="size-4"
											/>
										</DropdownMenuTrigger>
										<DropdownMenuContent>
											<Form method="post">
												<input type="hidden" name="intent" value="toggle" />
												<input type="hidden" name="id" value={user.id} />
												<DropdownMenuItem
													variant={user.active ? "destructive" : "default"}
													render={<button type="submit" className="w-full" />}
												>
													{user.active
														? t("admin_users.deactivate")
														: t("admin_users.activate")}
												</DropdownMenuItem>
											</Form>
											<Form method="post">
												<input
													type="hidden"
													name="intent"
													value="resetPassword"
												/>
												<input type="hidden" name="id" value={user.id} />
												<DropdownMenuItem
													render={<button type="submit" className="w-full" />}
												>
													{t("admin_users.reset_password")}
												</DropdownMenuItem>
											</Form>
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						))}
						{filtered.length === 0 && (
							<TableEmptyRow colSpan={5}>
								<EmptyState
									icon={UserIcon}
									title={
										users.length === 0
											? t("admin_users.no_users")
											: t("admin_users.no_matches")
									}
									description={
										users.length === 0
											? t("admin_users.no_users_hint")
											: undefined
									}
								/>
							</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</Card>

			<Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
				<DrawerContent
					title={t("admin_users.add_heading")}
					closeLabel={t("admin_users.close_drawer")}
				>
					<createFetcher.Form method="post" className="space-y-5">
						<input type="hidden" name="intent" value="create" />
						<div className="space-y-1.5">
							<Label htmlFor="name">{t("admin_users.name_label")}</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="email">{t("admin_users.email_label")}</Label>
							<Input id="email" name="email" type="email" required />
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="role">{t("admin_users.role_label")}</Label>
							<Select name="role" required>
								<SelectTrigger id="role" className="w-full">
									<SelectValue
										placeholder={t("admin_users.role_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{roles.map((r) => (
										<SelectItem key={r.value} value={r.value}>
											{t(r.labelKey as ParseKeys)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="tempPassword">
								{t("admin_users.temp_password_label")}
							</Label>
							<Input
								id="tempPassword"
								name="tempPassword"
								type="text"
								minLength={8}
								required
							/>
						</div>
						{createError && (
							<p className="rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
								{t(createError as ParseKeys)}
							</p>
						)}
						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setDrawerOpen(false)}
							>
								{t("admin_users.cancel")}
							</Button>
							<Button type="submit" loading={creating}>
								{t("admin_users.add_submit")}
							</Button>
						</div>
					</createFetcher.Form>
				</DrawerContent>
			</Drawer>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
