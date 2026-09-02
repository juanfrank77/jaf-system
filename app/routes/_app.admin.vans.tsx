import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button, buttonVariants } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { appendVanAssignmentHistory } from "~/lib/van-history"
import type { Route } from "./+types/_app.admin.vans"

type StockLevel = {
	serviceCodeId: string
	qty: number
}

type InstallerUser = { id: string; name: string; active: boolean }
type ServiceCodeOption = { id: string; claroCode: string; name: string }

export const meta: Route.MetaFunction = () => [{ title: "Vans — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const [vans, installers, serviceCodes] = await Promise.all([
		db.van.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "INSTALLER" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true },
		}),
		db.serviceCode.findMany({
			where: { active: true },
			orderBy: { claroCode: "asc" },
			select: { id: true, claroCode: true, name: true },
		}),
	])

	return { vans, installers, serviceCodes }
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

		const stockLevels: StockLevel[] = []
		for (const [key, value] of form.entries()) {
			if (key.startsWith("stock_")) {
				const serviceCodeId = key.slice("stock_".length)
				const qty = Number.parseInt(value as string, 10)
				if (!Number.isNaN(qty) && qty >= 0) {
					stockLevels.push({ serviceCodeId, qty })
				}
			}
		}

		if (typeof name !== "string" || !name.trim()) {
			return data(
				{ errorKey: "admin_vans.errors.invalid_name" },
				{ status: 400 },
			)
		}

		const dataPayload = {
			name: name.trim(),
			installerId:
				typeof installerId === "string" && installerId.trim()
					? installerId
					: null,
			standardStockLevels: stockLevels as any,
			active,
		}

		if (intent === "update" && typeof id === "string" && id.trim()) {
			const existing = await db.van.findUnique({ where: { id } })
			const existingLevels = (
				(existing?.standardStockLevels as StockLevel[]) || []
			).filter(Boolean) as StockLevel[]
			const mergedMap = new Map<string, number>(
				existingLevels.map((level) => [level.serviceCodeId, level.qty]),
			)
			for (const level of stockLevels) {
				mergedMap.set(level.serviceCodeId, level.qty)
			}
			const mergedLevels = existingLevels
				.map((level) => ({
					serviceCodeId: level.serviceCodeId,
					qty: mergedMap.get(level.serviceCodeId) ?? 0,
				}))
				.concat(
					Array.from(mergedMap.entries())
						.filter(
							([serviceCodeId]) =>
								!existingLevels.some((l) => l.serviceCodeId === serviceCodeId),
						)
						.map(([serviceCodeId, qty]) => ({ serviceCodeId, qty })),
				)
			if (dataPayload.installerId !== existing?.installerId) {
				await appendVanAssignmentHistory(id, dataPayload.installerId, user.id)
			}
			await db.van.update({
				where: { id },
				data: { ...dataPayload, standardStockLevels: mergedLevels as any },
			})
		} else {
			await db.van.create({ data: dataPayload })
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

export default function AdminVans({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { vans, installers, serviceCodes } = loaderData as {
		vans: {
			id: string
			name: string
			installerId: string | null
			standardStockLevels: unknown
			active: boolean
			vanAssignmentHistory?: unknown
		}[]
		installers: InstallerUser[]
		serviceCodes: ServiceCodeOption[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("admin_vans.title")}</h1>

			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">{t("admin_vans.add_heading")}</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1">
							<Label htmlFor="name">{t("admin_vans.name_label")}</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="installerId">
								{t("admin_vans.installer_label")}
							</Label>
							<Select name="installerId">
								<SelectTrigger id="installerId">
									<SelectValue
										placeholder={t("admin_vans.installer_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{installers.map((u) => (
										<SelectItem key={u.id} value={u.id}>
											{u.name} {!u.active && ` (${t("admin_vans.inactive")})`}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-2">
						<Label>{t("admin_vans.stock_levels_label")}</Label>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
							{serviceCodes.map((code) => (
								<div key={code.id} className="space-y-1">
									<Label
										htmlFor={`stock_${code.id}`}
										className="text-xs text-slate-500"
									>
										{code.claroCode} — {code.name}
									</Label>
									<Input
										id={`stock_${code.id}`}
										name={`stock_${code.id}`}
										type="number"
										min={0}
										defaultValue={0}
									/>
								</div>
							))}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox id="active" name="active" defaultChecked />
						<Label htmlFor="active" className="text-sm">
							{t("admin_vans.active_label")}
						</Label>
					</div>
					<Button type="submit">{t("admin_vans.add_submit")}</Button>
					{error && <p className="text-sm text-red-600">{t(error as any)}</p>}
				</Form>
			</section>

			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_vans.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_vans.table.installer")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_vans.table.stock_levels")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_vans.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_vans.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{vans.map((van) => {
							const installer = installers.find((u) => u.id === van.installerId)
							const levels = (van.standardStockLevels as StockLevel[]) || []
							return (
								<tr key={van.id} className="hover:bg-slate-50">
									<td className="px-4 py-3 font-medium">{van.name}</td>
									<td className="px-4 py-3 text-slate-600">
										{installer?.name ?? t("admin_vans.unassigned")}
									</td>
									<td className="px-4 py-3 text-xs text-slate-600">
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
									</td>
									<td className="px-4 py-3 text-center">
										<span
											className={
												van.active
													? "text-green-600 font-medium"
													: "text-slate-400"
											}
										>
											{van.active ? t("admin_vans.yes") : t("admin_vans.no")}
										</span>
									</td>
									<td className="px-4 py-3 text-center">
										<div className="flex items-center justify-center gap-2">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle" />
												<input type="hidden" name="id" value={van.id} />
												<Button type="submit" variant="outline" size="sm">
													{van.active
														? t("admin_vans.deactivate")
														: t("admin_vans.activate")}
												</Button>
											</Form>
											<EditVanDialog
												van={van}
												installers={installers}
												serviceCodes={serviceCodes}
												history={
													(van.vanAssignmentHistory as any[] | undefined) || []
												}
											/>
										</div>
									</td>
								</tr>
							)
						})}
						{vans.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("admin_vans.no_vans")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

function EditVanDialog({
	van,
	installers,
	serviceCodes,
	history = [],
}: {
	van: {
		id: string
		name: string
		installerId: string | null
		standardStockLevels: unknown
		active: boolean
		vanAssignmentHistory?: unknown
	}
	installers: InstallerUser[]
	serviceCodes: ServiceCodeOption[]
	history?: { installerId: string | null; from: string | null; to: string }[]
}) {
	const { t } = useTranslation()
	const levels = (van.standardStockLevels as StockLevel[]) || []
	const levelMap = new Map(levels.map((l) => [l.serviceCodeId, l.qty]))

	return (
		<details className="group">
			<summary className={buttonVariants({ variant: "outline", size: "sm" })}>
				{t("admin_vans.edit")}
			</summary>
			<Form method="post" className="mt-3 space-y-3 rounded-lg border p-3">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="id" value={van.id} />
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="space-y-1">
						<Label htmlFor={`name-${van.id}`}>
							{t("admin_vans.name_label")}
						</Label>
						<Input
							id={`name-${van.id}`}
							name="name"
							defaultValue={van.name}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor={`installer-${van.id}`}>
							{t("admin_vans.installer_label")}
						</Label>
						<Select name="installerId" defaultValue={van.installerId ?? ""}>
							<SelectTrigger id={`installer-${van.id}`}>
								<SelectValue />
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
				</div>
				<div className="space-y-2">
					<Label>{t("admin_vans.stock_levels_label")}</Label>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
						{serviceCodes.map((code) => (
							<div key={code.id} className="space-y-1">
								<Label
									htmlFor={`stock_${code.id}-${van.id}`}
									className="text-xs text-slate-500"
								>
									{code.claroCode} — {code.name}
								</Label>
								<Input
									id={`stock_${code.id}-${van.id}`}
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
						id={`active-${van.id}`}
						name="active"
						defaultChecked={van.active}
					/>
					<Label htmlFor={`active-${van.id}`} className="text-sm">
						{t("admin_vans.active_label")}
					</Label>
				</div>
				<Button type="submit" size="sm">
					{t("admin_vans.save")}
				</Button>
				{history.length > 0 && (
					<div className="mt-4 space-y-1">
						<p className="text-xs font-medium text-slate-500">
							{t("admin_vans.history_heading")}
						</p>
						<ul className="space-y-1 text-xs text-slate-600">
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
			</Form>
		</details>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
