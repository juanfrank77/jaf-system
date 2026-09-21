import {
	MoreHorizontalIcon,
	PencilEdit02Icon,
	PlusSignIcon,
	Search01Icon,
	TruckDeliveryIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys, TFunction } from "i18next"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
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
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import {
	appendVanAssignmentHistory,
	type VanAssignmentEvent,
} from "~/lib/van-history"
import {
	getVanParLevelsForVans,
	type ParLevel,
	parLevelsToStockLevels,
	setVanParLevels,
} from "~/lib/van-stock.server"
import type { Route } from "./+types/_app.admin.vans"

type StockLevel = {
	serviceCodeId: string
	qty: number
}

type InstallerUser = { id: string; name: string; active: boolean }
type ServiceCodeOption = { id: string; claroCode: string; name: string }
type Van = {
	id: string
	name: string
	installerId: string | null
	standardStockLevels: unknown
	active: boolean
	vanAssignmentHistory?: unknown
}

export const meta: Route.MetaFunction = () => [{ title: "Vans — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const [vansRaw, installers, serviceCodes] = await Promise.all([
		db.van.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "INSTALLER" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true },
		}),
		getActiveMaterialCodes(),
	])

	const parLevelsByVan = await getVanParLevelsForVans(
		vansRaw.map((van) => van.id),
	)
	const vans = vansRaw.map((van) => ({
		...van,
		standardStockLevels: parLevelsToStockLevels(
			parLevelsByVan.get(van.id) ?? [],
		),
	}))

	return {
		vans,
		installers,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const installerId = form.get("installerId")
		const active = form.get("active") === "on"

		const submittedParLevels: ParLevel[] = []
		for (const [key, value] of form.entries()) {
			if (key.startsWith("stock_")) {
				const serviceCodeId = key.slice("stock_".length)
				const qty = Number.parseInt(value as string, 10)
				if (Number.isNaN(qty)) continue
				if (qty < 0) {
					return data(
						{ errorKey: "admin_vans.errors.negative_par" },
						{ status: 400 },
					)
				}
				submittedParLevels.push({ serviceCodeId, parLevel: qty })
			}
		}

		if (typeof name !== "string" || !name.trim()) {
			return data(
				{ errorKey: "admin_vans.errors.invalid_name" },
				{ status: 400 },
			)
		}

		const vanFields = {
			name: name.trim(),
			installerId:
				typeof installerId === "string" && installerId.trim()
					? installerId
					: null,
			active,
		}

		if (intent === "update" && typeof id === "string" && id.trim()) {
			const existing = await db.van.findUnique({ where: { id } })
			if (vanFields.installerId !== existing?.installerId) {
				await appendVanAssignmentHistory(id, vanFields.installerId, user.id)
			}
			await db.$transaction(async (tx) => {
				await setVanParLevels(id, submittedParLevels, "update", tx)
				await tx.van.update({
					where: { id },
					data: vanFields,
				})
			})
		} else {
			await db.$transaction(async (tx) => {
				const van = await tx.van.create({
					data: {
						...vanFields,
						standardStockLevels: [],
					},
				})
				if (submittedParLevels.length > 0) {
					await setVanParLevels(van.id, submittedParLevels, "create", tx)
				}
			})
		}
		return redirect("/admin/vans")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_vans.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.van.findUniqueOrThrow({ where: { id } })
		await db.van.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/vans")
	}

	return data({ errorKey: "admin_vans.errors.unknown_intent" }, { status: 400 })
}

function VanForm({
	van,
	installers,
	serviceCodes,
	onSaved,
	onCancel,
	t,
}: {
	van: Van | null
	installers: InstallerUser[]
	serviceCodes: ServiceCodeOption[]
	onSaved: () => void
	onCancel: () => void
	t: TFunction
}) {
	const fetcher = useFetcher()
	const wasSubmitting = useRef(false)
	const submitting = fetcher.state !== "idle"
	const levels = (van?.standardStockLevels as StockLevel[]) || []
	const levelMap = new Map(levels.map((l) => [l.serviceCodeId, l.qty]))
	const history = ((van?.vanAssignmentHistory as
		| VanAssignmentEvent[]
		| undefined) || []) as {
		installerId: string | null
		from: string | null
		to: string
	}[]

	useEffect(() => {
		if (wasSubmitting.current && !submitting) onSaved()
		wasSubmitting.current = submitting
	}, [submitting, onSaved])

	return (
		<fetcher.Form method="post" className="space-y-5">
			<input type="hidden" name="intent" value={van ? "update" : "create"} />
			{van && <input type="hidden" name="id" value={van.id} />}
			<div className="space-y-1.5">
				<Label htmlFor="name">{t("admin_vans.name_label")}</Label>
				<Input id="name" name="name" defaultValue={van?.name} required />
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="installerId">{t("admin_vans.installer_label")}</Label>
				<Select name="installerId" defaultValue={van?.installerId ?? ""}>
					<SelectTrigger id="installerId" className="w-full">
						<SelectValue placeholder={t("admin_vans.installer_placeholder")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">
							{t("admin_vans.installer_placeholder")}
						</SelectItem>
						{installers.map((u) => (
							<SelectItem key={u.id} value={u.id}>
								{u.name} {!u.active && ` (${t("admin_vans.inactive")})`}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-2">
				<Label>{t("admin_vans.stock_levels_label")}</Label>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{serviceCodes.map((code) => (
						<div key={code.id} className="space-y-1">
							<Label
								htmlFor={`stock_${code.id}`}
								className="text-xs text-muted-foreground"
							>
								{code.claroCode} — {code.name}
							</Label>
							<Input
								id={`stock_${code.id}`}
								name={`stock_${code.id}`}
								type="number"
								min={0}
								defaultValue={levelMap.get(code.id) ?? 0}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id="active"
					name="active"
					defaultChecked={van?.active ?? true}
				/>
				<Label htmlFor="active" className="text-sm">
					{t("admin_vans.active_label")}
				</Label>
			</div>
			{history.length > 0 && (
				<div className="space-y-1 border-t border-border pt-4">
					<p className="text-xs font-medium text-muted-foreground">
						{t("admin_vans.history_heading")}
					</p>
					<ul className="space-y-1 text-xs text-muted-foreground">
						{history.map((entry) => {
							const installer = installers.find(
								(u) => u.id === entry.installerId,
							)
							const fromInstaller = entry.from
								? (installers.find((u) => u.id === entry.from)?.name ??
									entry.from)
								: t("admin_vans.unassigned")
							return (
								<li
									key={`${entry.installerId ?? "null"}-${entry.from ?? "null"}-${entry.to}`}
								>
									{installer?.name ?? t("admin_vans.unassigned")} — from{" "}
									{fromInstaller} on {new Date(entry.to).toLocaleString()}
								</li>
							)
						})}
					</ul>
				</div>
			)}
			<div className="flex justify-end gap-2 pt-2">
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t("admin_vans.cancel")}
				</Button>
				<Button type="submit" loading={submitting}>
					{van ? t("admin_vans.save") : t("admin_vans.add_submit")}
				</Button>
			</div>
		</fetcher.Form>
	)
}

export default function AdminVans({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { vans, installers, serviceCodes } = loaderData as {
		vans: Van[]
		installers: InstallerUser[]
		serviceCodes: ServiceCodeOption[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [drawerVan, setDrawerVan] = useState<Van | null>(null)
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "inactive"
	>("all")
	const [assignmentFilter, setAssignmentFilter] = useState<
		"all" | "assigned" | "unassigned"
	>("all")

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return vans.filter((van) => {
			if (statusFilter === "active" && !van.active) return false
			if (statusFilter === "inactive" && van.active) return false
			if (assignmentFilter === "assigned" && !van.installerId) return false
			if (assignmentFilter === "unassigned" && van.installerId) return false
			if (!term) return true
			const installer = installers.find((u) => u.id === van.installerId)
			return (
				van.name.toLowerCase().includes(term) ||
				(installer?.name.toLowerCase().includes(term) ?? false)
			)
		})
	}, [vans, installers, search, statusFilter, assignmentFilter])

	return (
		<div>
			<PageHeader
				title={t("admin_vans.title")}
				subtitle={t("admin_vans.subtitle")}
				actions={
					<Button
						onClick={() => {
							setDrawerVan(null)
							setDrawerOpen(true)
						}}
					>
						<HugeiconsIcon
							icon={PlusSignIcon}
							strokeWidth={2}
							className="size-4"
						/>
						{t("admin_vans.add_submit")}
					</Button>
				}
			/>

			{error && (
				<p className="mb-4 rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
					{t(error as ParseKeys)}
				</p>
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
						placeholder={t("admin_vans.search_placeholder")}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="sm:w-64"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{t("admin_vans.result_count", { count: filtered.length })}
						</span>
						<Select
							value={statusFilter}
							onValueChange={(value) =>
								setStatusFilter(value as typeof statusFilter)
							}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("admin_vans.table.active")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_vans.filter_all")}
								</SelectItem>
								<SelectItem value="active">
									{t("admin_vans.filter_active")}
								</SelectItem>
								<SelectItem value="inactive">
									{t("admin_vans.filter_inactive")}
								</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={assignmentFilter}
							onValueChange={(value) =>
								setAssignmentFilter(value as typeof assignmentFilter)
							}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("admin_vans.table.installer")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_vans.filter_assignment_all")}
								</SelectItem>
								<SelectItem value="assigned">
									{t("admin_vans.filter_assigned")}
								</SelectItem>
								<SelectItem value="unassigned">
									{t("admin_vans.filter_unassigned")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</TableToolbar>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("admin_vans.table.name")}</TableHead>
							<TableHead>{t("admin_vans.table.installer")}</TableHead>
							<TableHead>{t("admin_vans.table.stock_levels")}</TableHead>
							<TableHead>{t("admin_vans.table.active")}</TableHead>
							<TableHead className="text-right">
								{t("admin_vans.table.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map((van) => {
							const installer = installers.find((u) => u.id === van.installerId)
							const levels = (van.standardStockLevels as StockLevel[]) || []
							return (
								<TableRow key={van.id} data-inactive={!van.active || undefined}>
									<TableCell className="font-medium">{van.name}</TableCell>
									<TableCell className="text-muted-foreground">
										{installer?.name ?? t("admin_vans.unassigned")}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{levels.length === 0
											? t("admin_vans.no_stock_levels")
											: levels.map((level) => {
													const code = serviceCodes.find(
														(c) => c.id === level.serviceCodeId,
													)
													return (
														<div key={level.serviceCodeId}>
															{code?.claroCode ?? level.serviceCodeId}:{" "}
															{level.qty}
														</div>
													)
												})}
									</TableCell>
									<TableCell>
										<Badge variant={van.active ? "ok" : "neutral"} dot>
											{van.active
												? t("admin_vans.status_active")
												: t("admin_vans.status_inactive")}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label={t("admin_vans.edit")}
												onClick={() => {
													setDrawerVan(van)
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
													aria-label={t("admin_vans.row_menu")}
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
														<input type="hidden" name="id" value={van.id} />
														<DropdownMenuItem
															variant={van.active ? "destructive" : "default"}
															render={
																<button type="submit" className="w-full" />
															}
														>
															{van.active
																? t("admin_vans.deactivate")
																: t("admin_vans.activate")}
														</DropdownMenuItem>
													</Form>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</TableCell>
								</TableRow>
							)
						})}
						{filtered.length === 0 && (
							<TableEmptyRow colSpan={5}>
								<EmptyState
									icon={TruckDeliveryIcon}
									title={
										vans.length === 0
											? t("admin_vans.no_vans")
											: t("admin_vans.no_matches")
									}
									description={
										vans.length === 0 ? t("admin_vans.no_vans_hint") : undefined
									}
								/>
							</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</Card>

			<Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
				<DrawerContent
					title={
						drawerVan
							? t("admin_vans.edit_heading")
							: t("admin_vans.add_heading")
					}
					closeLabel={t("admin_vans.close_drawer")}
				>
					<VanForm
						van={drawerVan}
						installers={installers}
						serviceCodes={serviceCodes}
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
