import {
	MoreHorizontalIcon,
	PencilEdit02Icon,
	PlusSignIcon,
	Search01Icon,
	UserGroup03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys, TFunction } from "i18next"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Avatar } from "~/components/ui/avatar"
import { AvatarStack } from "~/components/ui/avatar-stack"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardHeaderText,
	CardTitle,
} from "~/components/ui/card"
import { Checkbox } from "~/components/ui/checkbox"
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
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.admin.crews"

type CrewUser = {
	id: string
	name: string
	active: boolean
	image: string | null
}
type Crew = { id: string; name: string; memberIds: string[]; active: boolean }

export const meta: Route.MetaFunction = () => [{ title: "Crews — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const [crews, crewUsers] = await Promise.all([
		db.brigade.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "CREW" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true, image: true },
		}),
	])

	return { crews, crewUsers }
}

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const memberIds = form.getAll("memberIds")
		const active = form.get("active") === "on"

		if (
			typeof name !== "string" ||
			!name.trim() ||
			!memberIds.every((m) => typeof m === "string")
		) {
			return data(
				{ errorKey: "admin_crews.errors.invalid_fields" },
				{ status: 400 },
			)
		}

		const dataPayload = {
			name: name.trim(),
			memberIds: memberIds as string[],
			active,
		}

		if (intent === "update" && typeof id === "string" && id.trim()) {
			await db.brigade.update({ where: { id }, data: dataPayload })
		} else {
			await db.brigade.create({ data: dataPayload })
		}
		return redirect("/admin/crews")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_crews.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.brigade.findUniqueOrThrow({ where: { id } })
		await db.brigade.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/crews")
	}

	return data(
		{ errorKey: "admin_crews.errors.unknown_intent" },
		{ status: 400 },
	)
}

function CrewForm({
	crew,
	crewUsers,
	onSaved,
	onCancel,
	t,
}: {
	crew: Crew | null
	crewUsers: CrewUser[]
	onSaved: () => void
	onCancel: () => void
	t: TFunction
}) {
	const fetcher = useFetcher()
	const wasSubmitting = useRef(false)
	const submitting = fetcher.state !== "idle"

	useEffect(() => {
		if (wasSubmitting.current && !submitting) onSaved()
		wasSubmitting.current = submitting
	}, [submitting, onSaved])

	return (
		<fetcher.Form method="post" className="space-y-5">
			<input type="hidden" name="intent" value={crew ? "update" : "create"} />
			{crew && <input type="hidden" name="id" value={crew.id} />}
			<div className="space-y-1.5">
				<Label htmlFor="name">{t("admin_crews.name_label")}</Label>
				<Input id="name" name="name" defaultValue={crew?.name} required />
			</div>
			<div className="space-y-2">
				<p className="text-sm font-medium text-foreground">
					{t("admin_crews.members_label")}
				</p>
				<div className="grid grid-cols-1 gap-2">
					{crewUsers.map((u) => (
						<label
							key={u.id}
							htmlFor={`member-${crew?.id ?? "new"}-${u.id}`}
							className="flex items-center gap-2 text-sm"
						>
							<Checkbox
								id={`member-${crew?.id ?? "new"}-${u.id}`}
								name="memberIds"
								value={u.id}
								defaultChecked={crew?.memberIds.includes(u.id)}
							/>
							<Avatar
								name={u.name}
								src={u.image ? `/avatars/${u.id}` : null}
								className="size-6"
							/>
							<span>
								{u.name}{" "}
								<span className="text-muted-foreground">
									(
									{u.active
										? t("admin_crews.active")
										: t("admin_crews.inactive")}
									)
								</span>
							</span>
						</label>
					))}
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id="active"
					name="active"
					defaultChecked={crew?.active ?? true}
				/>
				<Label htmlFor="active" className="text-sm">
					{t("admin_crews.active_label")}
				</Label>
			</div>
			<div className="flex justify-end gap-2 pt-2">
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t("admin_crews.cancel")}
				</Button>
				<Button type="submit" loading={submitting}>
					{crew ? t("admin_crews.save") : t("admin_crews.add_submit")}
				</Button>
			</div>
		</fetcher.Form>
	)
}

export default function AdminCrews({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { crews, crewUsers } = loaderData as {
		crews: Crew[]
		crewUsers: CrewUser[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [drawerCrew, setDrawerCrew] = useState<Crew | null>(null)
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "inactive"
	>("all")

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return crews.filter((crew) => {
			if (statusFilter === "active" && !crew.active) return false
			if (statusFilter === "inactive" && crew.active) return false
			if (!term) return true
			if (crew.name.toLowerCase().includes(term)) return true
			return crewUsers.some(
				(user) =>
					crew.memberIds.includes(user.id) &&
					user.name.toLowerCase().includes(term),
			)
		})
	}, [crews, crewUsers, search, statusFilter])

	return (
		<div>
			<PageHeader
				title={t("admin_crews.title")}
				subtitle={t("admin_crews.subtitle")}
				actions={
					<Button
						onClick={() => {
							setDrawerCrew(null)
							setDrawerOpen(true)
						}}
					>
						<HugeiconsIcon
							icon={PlusSignIcon}
							strokeWidth={2}
							className="size-4"
						/>
						{t("admin_crews.add_submit")}
					</Button>
				}
			/>

			{error && (
				<p className="mb-4 rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
					{t(error as ParseKeys)}
				</p>
			)}

			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Input
					leading={
						<HugeiconsIcon
							icon={Search01Icon}
							strokeWidth={2}
							className="size-4"
						/>
					}
					placeholder={t("admin_crews.search_placeholder")}
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					className="sm:w-64"
				/>
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{t("admin_crews.result_count", { count: filtered.length })}
					</span>
					<Select
						value={statusFilter}
						onValueChange={(value) =>
							setStatusFilter(value as typeof statusFilter)
						}
					>
						<SelectTrigger size="sm" aria-label={t("admin_crews.active_label")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">{t("admin_crews.filter_all")}</SelectItem>
							<SelectItem value="active">
								{t("admin_crews.filter_active")}
							</SelectItem>
							<SelectItem value="inactive">
								{t("admin_crews.filter_inactive")}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{filtered.length === 0 ? (
				<Card>
					<EmptyState
						icon={UserGroup03Icon}
						title={
							crews.length === 0
								? t("admin_crews.no_crews")
								: t("admin_crews.no_matches")
						}
						description={
							crews.length === 0 ? t("admin_crews.no_crews_hint") : undefined
						}
					/>
				</Card>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((crew) => {
						const members = crewUsers.filter((u) =>
							crew.memberIds.includes(u.id),
						)
						return (
							<Card key={crew.id} data-inactive={!crew.active || undefined}>
								<CardHeader>
									<CardHeaderText>
										<CardTitle>{crew.name}</CardTitle>
									</CardHeaderText>
									<div className="flex shrink-0 items-center gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={t("admin_crews.edit")}
											onClick={() => {
												setDrawerCrew(crew)
												setDrawerOpen(true)
											}}
										>
											<HugeiconsIcon
												icon={PencilEdit02Icon}
												strokeWidth={2}
												className="size-4"
											/>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												aria-label={t("admin_crews.row_menu")}
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
													<input type="hidden" name="id" value={crew.id} />
													<DropdownMenuItem
														variant={crew.active ? "destructive" : "default"}
														render={<button type="submit" className="w-full" />}
													>
														{crew.active
															? t("admin_crews.deactivate")
															: t("admin_crews.activate")}
													</DropdownMenuItem>
												</Form>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</CardHeader>
								<CardContent>
									{members.length > 0 ? (
										<AvatarStack people={members} />
									) : (
										<p className="text-sm text-muted-foreground">
											{t("admin_crews.no_members")}
										</p>
									)}
								</CardContent>
								<CardFooter className="justify-between">
									<span className="text-xs text-muted-foreground">
										{t("admin_crews.members_label")}: {members.length}
									</span>
									<Badge variant={crew.active ? "ok" : "neutral"} dot>
										{crew.active
											? t("admin_crews.status_active")
											: t("admin_crews.status_inactive")}
									</Badge>
								</CardFooter>
							</Card>
						)
					})}
				</div>
			)}

			<Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
				<DrawerContent
					title={
						drawerCrew
							? t("admin_crews.edit_heading")
							: t("admin_crews.add_heading")
					}
					closeLabel={t("admin_crews.close_drawer")}
				>
					<CrewForm
						crew={drawerCrew}
						crewUsers={crewUsers}
						onSaved={() => setDrawerOpen(false)}
						onCancel={() => setDrawerOpen(false)}
						t={t}
					/>
				</DrawerContent>
			</Drawer>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
