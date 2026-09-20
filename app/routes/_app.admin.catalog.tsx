import {
	MoreHorizontalIcon,
	PencilEdit02Icon,
	PlusSignIcon,
	Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TFunction } from "i18next"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, redirect, useFetcher } from "react-router"
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
	TableFooter,
	TableHead,
	TableHeader,
	TablePagination,
	TableRow,
	TableToolbar,
} from "~/components/ui/table"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.catalog"

export const meta: Route.MetaFunction = () => [
	{ title: "Service Catalog — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const codes = await db.serviceCode.findMany({
		orderBy: { claroCode: "asc" },
	})

	return {
		codes: codes.map((code) => ({
			...code,
			unitPrice: toNumberPrice(code.unitPrice),
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["ADMIN"])

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create") {
		const claroCode = formData.get("claroCode")
		const name = formData.get("name")
		const unitPrice = formData.get("unitPrice")
		const unit = formData.get("unit")
		const accountCode = formData.get("accountCode")
		const dept = formData.get("dept")

		if (
			typeof claroCode !== "string" ||
			!claroCode.trim() ||
			typeof name !== "string" ||
			!name.trim() ||
			typeof unitPrice !== "string" ||
			!unitPrice.trim()
		) {
			return data(
				{ errorKey: "admin_catalog.errors.required_fields" },
				{ status: 400 },
			)
		}

		await db.serviceCode.create({
			data: {
				claroCode: claroCode.trim(),
				name: name.trim(),
				unitPrice: Number.parseFloat(unitPrice),
				unit:
					typeof unit === "string" && unit.trim()
						? unit.trim().toUpperCase()
						: "",
				accountCode:
					typeof accountCode === "string" && accountCode.trim()
						? accountCode.trim()
						: null,
				dept: typeof dept === "string" && dept.trim() ? dept.trim() : null,
			},
		})

		return redirect("/admin/catalog")
	}

	if (intent === "toggle") {
		const id = formData.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_catalog.errors.id_required" },
				{ status: 400 },
			)
		}

		const existing = await db.serviceCode.findUniqueOrThrow({
			where: { id },
		})

		await db.serviceCode.update({
			where: { id },
			data: { active: !existing.active },
		})

		return redirect("/admin/catalog")
	}

	if (intent === "update") {
		const id = formData.get("id")
		const claroCode = formData.get("claroCode")
		const name = formData.get("name")
		const unitPrice = formData.get("unitPrice")
		const accountCode = formData.get("accountCode")
		const dept = formData.get("dept")

		if (
			typeof id !== "string" ||
			!id.trim() ||
			typeof claroCode !== "string" ||
			!claroCode.trim() ||
			typeof name !== "string" ||
			!name.trim() ||
			typeof unitPrice !== "string" ||
			!unitPrice.trim()
		) {
			return data(
				{ errorKey: "admin_catalog.errors.required_fields" },
				{ status: 400 },
			)
		}

		await db.serviceCode.update({
			where: { id },
			data: {
				claroCode: claroCode.trim(),
				name: name.trim(),
				unitPrice: Number.parseFloat(unitPrice),
				accountCode:
					typeof accountCode === "string" && accountCode.trim()
						? accountCode.trim()
						: null,
				dept: typeof dept === "string" && dept.trim() ? dept.trim() : null,
			},
		})

		return redirect("/admin/catalog")
	}

	return data(
		{ errorKey: "admin_catalog.errors.unknown_intent" },
		{ status: 400 },
	)
}

type ServiceCode = Route.ComponentProps["loaderData"]["codes"][number]

const PAGE_SIZE = 20

function CatalogForm({
	code,
	onSaved,
	onCancel,
	t,
}: {
	code: ServiceCode | null
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
			<input type="hidden" name="intent" value={code ? "update" : "create"} />
			{code && <input type="hidden" name="id" value={code.id} />}
			<div className="space-y-1.5">
				<Label htmlFor="claroCode">{t("admin_catalog.claro_code_label")}</Label>
				<Input
					id="claroCode"
					name="claroCode"
					defaultValue={code?.claroCode}
					required
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="name">{t("admin_catalog.name_label")}</Label>
				<Input id="name" name="name" defaultValue={code?.name} required />
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-1.5">
					<Label htmlFor="unitPrice">
						{t("admin_catalog.unit_price_label")}
					</Label>
					<Input
						id="unitPrice"
						name="unitPrice"
						type="number"
						step="0.01"
						min="0"
						leading="$"
						defaultValue={code ? toNumberPrice(code.unitPrice) : undefined}
						required
					/>
				</div>
				{!code && (
					<div className="space-y-1.5">
						<Label htmlFor="unit">{t("admin_catalog.unit_label")}</Label>
						<Input id="unit" name="unit" />
						<p className="text-xs text-muted-foreground">
							{t("admin_catalog.unit_help")}
						</p>
					</div>
				)}
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-1.5">
					<Label htmlFor="accountCode">
						{t("admin_catalog.account_code_label")}
					</Label>
					<Input
						id="accountCode"
						name="accountCode"
						defaultValue={code?.accountCode ?? ""}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="dept">{t("admin_catalog.dept_label")}</Label>
					<Input id="dept" name="dept" defaultValue={code?.dept ?? ""} />
				</div>
			</div>
			<div className="flex justify-end gap-2 pt-2">
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t("admin_catalog.cancel")}
				</Button>
				<Button type="submit" loading={submitting}>
					{code ? t("admin_catalog.save") : t("admin_catalog.add_submit")}
				</Button>
			</div>
		</fetcher.Form>
	)
}

export default function AdminCatalog({ loaderData }: Route.ComponentProps) {
	const { codes } = loaderData
	const { t } = useTranslation()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [drawerCode, setDrawerCode] = useState<ServiceCode | null>(null)
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "inactive"
	>("all")
	const [deptFilter, setDeptFilter] = useState("all")
	const [kindFilter, setKindFilter] = useState<"all" | "SERVICE" | "MATERIAL">(
		"all",
	)
	const [page, setPage] = useState(1)

	const departments = useMemo(() => {
		const values = new Set<string>()
		for (const code of codes) {
			if (code.dept?.trim()) values.add(code.dept.trim())
		}
		return [...values].sort((a, b) => a.localeCompare(b))
	}, [codes])
	const hasMissingDept = codes.some((code) => !code.dept?.trim())

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return codes.filter((code) => {
			if (statusFilter === "active" && !code.active) return false
			if (statusFilter === "inactive" && code.active) return false
			if (kindFilter !== "all" && code.kind !== kindFilter) return false
			if (deptFilter === "none") {
				if (code.dept?.trim()) return false
			} else if (
				deptFilter !== "all" &&
				(code.dept ?? "").trim() !== deptFilter
			) {
				return false
			}
			if (!term) return true
			return (
				code.claroCode.toLowerCase().includes(term) ||
				code.name.toLowerCase().includes(term) ||
				(code.accountCode?.toLowerCase().includes(term) ?? false) ||
				(code.dept?.toLowerCase().includes(term) ?? false)
			)
		})
	}, [codes, search, statusFilter, deptFilter, kindFilter])

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
	const currentPage = Math.min(page, pageCount)
	const pageRows = filtered.slice(
		(currentPage - 1) * PAGE_SIZE,
		currentPage * PAGE_SIZE,
	)

	function openCreate() {
		setDrawerCode(null)
		setDrawerOpen(true)
	}

	function openEdit(code: ServiceCode) {
		setDrawerCode(code)
		setDrawerOpen(true)
	}

	return (
		<div>
			<PageHeader
				title={t("admin_catalog.title")}
				subtitle={t("admin_catalog.subtitle")}
				actions={
					<Button onClick={openCreate}>
						<HugeiconsIcon
							icon={PlusSignIcon}
							strokeWidth={2}
							className="size-4"
						/>
						{t("admin_catalog.add_submit")}
					</Button>
				}
			/>

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
						placeholder={t("admin_catalog.search_placeholder")}
						value={search}
						onChange={(e) => {
							setSearch(e.target.value)
							setPage(1)
						}}
						className="sm:w-64"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{t("admin_catalog.result_count", { count: filtered.length })}
						</span>
						<Select
							value={statusFilter}
							onValueChange={(value) => {
								setStatusFilter(value as typeof statusFilter)
								setPage(1)
							}}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("admin_catalog.table.active")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_catalog.filter_all")}
								</SelectItem>
								<SelectItem value="active">
									{t("admin_catalog.filter_active")}
								</SelectItem>
								<SelectItem value="inactive">
									{t("admin_catalog.filter_inactive")}
								</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={kindFilter}
							onValueChange={(value) => {
								setKindFilter(value as typeof kindFilter)
								setPage(1)
							}}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("admin_catalog.filter_all_kinds")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("admin_catalog.filter_all_kinds")}
								</SelectItem>
								<SelectItem value="SERVICE">
									{t("admin_catalog.filter_kind_service")}
								</SelectItem>
								<SelectItem value="MATERIAL">
									{t("admin_catalog.filter_kind_material")}
								</SelectItem>
							</SelectContent>
						</Select>
						{departments.length > 0 && (
							<Select
								value={deptFilter}
								onValueChange={(value) => {
									setDeptFilter(value ?? "all")
									setPage(1)
								}}
							>
								<SelectTrigger
									size="sm"
									aria-label={t("admin_catalog.table.dept")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										{t("admin_catalog.filter_all_depts")}
									</SelectItem>
									{departments.map((dept) => (
										<SelectItem key={dept} value={dept}>
											{dept}
										</SelectItem>
									))}
									{hasMissingDept && (
										<SelectItem value="none">
											{t("admin_catalog.filter_no_dept")}
										</SelectItem>
									)}
								</SelectContent>
							</Select>
						)}
					</div>
				</TableToolbar>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("admin_catalog.table.claro_code")}</TableHead>
							<TableHead>{t("admin_catalog.table.name")}</TableHead>
							<TableHead className="text-right">
								{t("admin_catalog.table.unit_price")}
							</TableHead>
							<TableHead className="hidden lg:table-cell">
								{t("admin_catalog.table.account_code")}
							</TableHead>
							<TableHead className="hidden lg:table-cell">
								{t("admin_catalog.table.dept")}
							</TableHead>
							<TableHead>{t("admin_catalog.table.active")}</TableHead>
							<TableHead className="text-right">
								{t("admin_catalog.table.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{pageRows.map((code) => (
							<TableRow key={code.id} data-inactive={!code.active || undefined}>
								<TableCell className="font-mono text-xs">
									{code.claroCode}
								</TableCell>
								<TableCell>{code.name}</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatMoney(code.unitPrice)}
								</TableCell>
								<TableCell className="hidden text-muted-foreground lg:table-cell">
									{code.accountCode ?? "—"}
								</TableCell>
								<TableCell className="hidden text-muted-foreground lg:table-cell">
									{code.dept ?? "—"}
								</TableCell>
								<TableCell>
									<Badge variant={code.active ? "ok" : "neutral"} dot>
										{code.active
											? t("admin_catalog.status_active")
											: t("admin_catalog.status_inactive")}
									</Badge>
								</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={t("admin_catalog.edit")}
											onClick={() => openEdit(code)}
										>
											<HugeiconsIcon
												icon={PencilEdit02Icon}
												strokeWidth={2}
												className="size-4"
											/>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												aria-label={t("admin_catalog.row_menu")}
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
												<form
													method="post"
													onSubmit={(event) => {
														if (
															code.active &&
															!confirm(
																t("admin_catalog.confirm_deactivate", {
																	name: code.name,
																}),
															)
														) {
															event.preventDefault()
														}
													}}
												>
													<input type="hidden" name="intent" value="toggle" />
													<input type="hidden" name="id" value={code.id} />
													<DropdownMenuItem
														variant={code.active ? "destructive" : "default"}
														render={<button type="submit" className="w-full" />}
													>
														{code.active
															? t("admin_catalog.deactivate")
															: t("admin_catalog.activate")}
													</DropdownMenuItem>
												</form>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</TableCell>
							</TableRow>
						))}
						{pageRows.length === 0 && (
							<TableEmptyRow colSpan={7}>
								<EmptyState
									icon={Search01Icon}
									title={
										codes.length === 0
											? t("admin_catalog.no_codes")
											: t("admin_catalog.no_matches")
									}
									description={
										codes.length === 0
											? t("admin_catalog.no_codes_hint")
											: undefined
									}
								/>
							</TableEmptyRow>
						)}
					</TableBody>
				</Table>
				{filtered.length > PAGE_SIZE && (
					<TableFooter>
						<TablePagination
							page={currentPage}
							pageCount={pageCount}
							onPageChange={setPage}
							labelPrev={t("admin_catalog.pagination_prev")}
							labelNext={t("admin_catalog.pagination_next")}
						/>
					</TableFooter>
				)}
			</Card>

			<Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
				<DrawerContent
					title={
						drawerCode
							? t("admin_catalog.edit_heading")
							: t("admin_catalog.add_heading")
					}
					closeLabel={t("admin_catalog.close_drawer")}
				>
					<CatalogForm
						code={drawerCode}
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
