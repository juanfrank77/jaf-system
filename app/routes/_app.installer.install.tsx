import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { InstallerInstallV2 } from "~/components/design-system/installer-install"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { useOnline } from "~/hooks/use-online"
import { db } from "~/lib/db.server"
import { isInstallerV2Enabled } from "~/lib/features.server"
import { queueInstallerInstall } from "~/lib/installer-sync"
import { requireRole } from "~/lib/permissions.server"
import {
	buildInventoryComparison,
	computeVanInventory,
} from "~/lib/van-inventory"
import { getVanParLevels, parLevelsToStockLevels } from "~/lib/van-stock.server"
import type { Route } from "./+types/_app.installer.install"

const SERVICE_TYPES = ["CABLE_TV", "WIFI", "PHONE", "OTHER"] as const

export const meta: Route.MetaFunction = () => [
	{ title: "Log Install — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const [van, serviceCodes] = await Promise.all([
		db.van.findUnique({ where: { installerId: user.id } }),
		db.serviceCode.findMany({
			where: { active: true },
			orderBy: { claroCode: "asc" },
		}),
	])
	if (!van) throw redirect("/installer")

	const [transactions, parLevels] = await Promise.all([
		db.vanInventoryTransaction.findMany({ where: { vanId: van.id } }),
		getVanParLevels(van.id),
	])
	const serviceCodeMap = new Map(
		serviceCodes.map((c) => [c.id, { claroCode: c.claroCode, name: c.name }]),
	)
	const comparison = buildInventoryComparison(
		transactions,
		parLevelsToStockLevels(parLevels),
		serviceCodeMap,
	)

	return {
		version: isInstallerV2Enabled() ? "v2" : "v1",
		van,
		serviceCodes,
		comparison,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const van = await db.van.findUnique({ where: { installerId: user.id } })
	if (!van) {
		return data(
			{ errorKey: "installer_install.errors.no_van" },
			{ status: 400 },
		)
	}

	const form = await request.formData()
	const claroJobReference =
		(form.get("claroJobReference") as string)?.trim() || ""
	const serviceType = (form.get("serviceType") as string) || ""
	const dateRaw = form.get("date") as string
	const itemsRaw = form.get("items") as string
	const notes = (form.get("notes") as string | null)?.trim() || null

	if (!claroJobReference || !serviceType || !dateRaw) {
		return data(
			{ errorKey: "installer_install.errors.missing_fields" },
			{ status: 400 },
		)
	}

	let items: { serviceCodeId: string; qty: number }[] = []
	try {
		items = JSON.parse(itemsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return data(
			{ errorKey: "installer_install.errors.invalid_items" },
			{ status: 400 },
		)
	}

	const uniqueServiceCodeIds = Array.from(
		new Set(items.map((i) => i.serviceCodeId)),
	)
	const validServiceCodes = await db.serviceCode.findMany({
		where: { id: { in: uniqueServiceCodeIds }, active: true },
		select: { id: true },
	})
	const validServiceCodeSet = new Set(validServiceCodes.map((c) => c.id))
	const invalidServiceCodes = uniqueServiceCodeIds.filter(
		(id) => !validServiceCodeSet.has(id),
	)
	if (invalidServiceCodes.length > 0) {
		return data(
			{ errorKey: "installer_install.errors.invalid_service_codes" },
			{ status: 400 },
		)
	}

	const date = new Date(dateRaw)
	if (Number.isNaN(date.getTime())) {
		return data(
			{ errorKey: "installer_install.errors.invalid_date" },
			{ status: 400 },
		)
	}

	if (request.headers.get("X-Offline-Sync") === "true") {
		if (!van.active) {
			return data({ conflict: "VAN_INACTIVE" }, { status: 409 })
		}
	}

	await db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM "Van" WHERE id = ${van.id} FOR UPDATE`
		const transactions = await tx.$queryRaw<
			{ serviceCodeId: string; qty: number }[]
		>`
			SELECT serviceCodeId, SUM(qty) as qty
			FROM "VanInventoryTransaction"
			WHERE vanId = ${van.id}
			GROUP BY serviceCodeId
		`
		const inventory = computeVanInventory(
			transactions.map((t) => ({
				serviceCodeId: t.serviceCodeId,
				qty: t.qty,
				type: "INSTALL",
			})),
		)
		let discrepancyFlagged = false
		for (const item of items) {
			const onHand = inventory.get(item.serviceCodeId) ?? 0
			if (onHand < item.qty) {
				discrepancyFlagged = true
				break
			}
		}
		const log = await tx.installLog.create({
			data: {
				installerId: user.id,
				vanId: van.id,
				claroJobReference,
				serviceType,
				date,
				materialsUsed: items,
				notes,
				discrepancyFlagged,
			},
		})
		await tx.vanInventoryTransaction.createMany({
			data: items.map((item) => ({
				vanId: van.id,
				serviceCodeId: item.serviceCodeId,
				qty: -item.qty,
				type: "INSTALL",
				referenceId: log.id,
				createdById: user.id,
				note: `Install ${claroJobReference}`,
			})),
		})
		if (discrepancyFlagged) {
			const warehouseUsers = await tx.user.findMany({
				where: { role: { in: ["WAREHOUSE", "ADMIN"] }, active: true },
			})
			for (const w of warehouseUsers) {
				await tx.notification.create({
					data: {
						userId: w.id,
						message: `Install ${claroJobReference} logged by ${van.name} used more stock than on hand.`,
					},
				})
			}
		}
	})

	throw redirect("/installer")
}

export default function LogInstall({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes, comparison, version } = loaderData
	const { t } = useTranslation()
	const errorKey =
		actionData && "errorKey" in actionData
			? (actionData.errorKey as string)
			: null
	const online = useOnline()
	const [queued, setQueued] = useState(false)

	const [lines, setLines] = useState<
		{ _key: string; serviceCodeId: string; qty: number }[]
	>([{ _key: "1", serviceCodeId: "", qty: 1 }])

	const addLine = () =>
		setLines([
			...lines,
			{ _key: String(Date.now()), serviceCodeId: "", qty: 1 },
		])
	const removeLine = (key: string) =>
		setLines(lines.filter((l) => l._key !== key))
	const updateLine = (
		key: string,
		patch: Partial<{ serviceCodeId: string; qty: number }>,
	) => setLines(lines.map((l) => (l._key === key ? { ...l, ...patch } : l)))

	function handleOfflineSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = e.currentTarget
		const formData = new FormData(form)
		const claroJobReference =
			(formData.get("claroJobReference") as string)?.trim() || ""
		const serviceType = (formData.get("serviceType") as string) || ""
		const dateRaw = formData.get("date") as string
		const itemsRaw = formData.get("items") as string
		const notes = (formData.get("notes") as string | null)?.trim() || null
		let items: { serviceCodeId: string; qty: number }[] = []
		try {
			items = JSON.parse(itemsRaw).filter(
				(i: { serviceCodeId: string; qty: number }) =>
					i.serviceCodeId && i.qty > 0,
			)
		} catch {
			// ignore, validation happens on sync
		}
		queueInstallerInstall({
			claroJobReference,
			serviceType,
			date: dateRaw,
			items,
			notes,
		}).then(() => setQueued(true))
	}

	if (version === "v2") {
		return (
			<InstallerInstallV2
				serviceCodes={serviceCodes}
				comparison={comparison}
				errorKey={errorKey}
			/>
		)
	}

	const used = new Set(lines.map((l) => l.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter((c) => !used.has(c.id))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("installer_install.title")}</h1>

			{errorKey && (
				<p className="text-sm text-red-600">{t(errorKey as never)}</p>
			)}

			{queued && (
				<div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
					{t("installer_install.queued_message")}
				</div>
			)}

			{!online && !queued && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
					{t("installer_install.offline_submit_notice")}
				</div>
			)}

			<Form
				method="post"
				className="space-y-4"
				onSubmit={(e) => {
					if (!online) {
						e.preventDefault()
						handleOfflineSubmit(e)
					}
				}}
			>
				<div>
					<Label htmlFor="claroJobReference">
						{t("installer_install.claro_ref_label")}
					</Label>
					<Input
						id="claroJobReference"
						name="claroJobReference"
						required
						placeholder={t("installer_install.claro_ref_placeholder")}
					/>
				</div>

				<div>
					<Label htmlFor="serviceType">
						{t("installer_install.service_type_label")}
					</Label>
					<Select name="serviceType" required>
						<SelectTrigger id="serviceType" className="mt-1">
							<SelectValue
								placeholder={t("installer_install.service_type_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{SERVICE_TYPES.map((type) => {
								const key =
									`installer_install.service_type.${type.toLowerCase()}` as const
								return (
									<SelectItem key={type} value={type}>
										{t(key as never)}
									</SelectItem>
								)
							})}
						</SelectContent>
					</Select>
				</div>

				<div>
					<Label htmlFor="date">{t("installer_install.date_label")}</Label>
					<Input
						id="date"
						name="date"
						type="date"
						required
						defaultValue={new Date().toISOString().split("T")[0]}
					/>
				</div>

				<div className="space-y-2">
					<Label>{t("installer_install.materials_label")}</Label>
					<input
						type="hidden"
						name="items"
						value={JSON.stringify(
							lines.map(({ serviceCodeId, qty }) => ({ serviceCodeId, qty })),
						)}
					/>
					{lines.map((line) => {
						const selected = line.serviceCodeId
							? serviceCodes.filter(
									(c: { id: string }) => c.id === line.serviceCodeId,
								)
							: []
						const options = [...selected, ...available]
						return (
							<div key={line._key} className="flex items-center gap-2">
								<Select
									value={line.serviceCodeId}
									onValueChange={(v) =>
										updateLine(line._key, { serviceCodeId: v ?? "" })
									}
								>
									<SelectTrigger className="flex-1">
										<SelectValue
											placeholder={t("installer_install.material_placeholder")}
										/>
									</SelectTrigger>
									<SelectContent>
										{options.map(
											(c: { id: string; claroCode: string; name: string }) => (
												<SelectItem key={c.id} value={c.id}>
													{c.claroCode} — {c.name}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
								<Input
									type="number"
									min={1}
									value={line.qty}
									onChange={(e) =>
										updateLine(line._key, {
											qty: Number.parseInt(e.target.value, 10) || 1,
										})
									}
									className="w-20"
								/>
								<button
									type="button"
									onClick={() => removeLine(line._key)}
									className="text-slate-400 hover:text-red-600 text-lg"
								>
									×
								</button>
							</div>
						)
					})}
					<Button type="button" variant="outline" size="sm" onClick={addLine}>
						{t("installer_install.add_material")}
					</Button>
				</div>

				<div>
					<Label htmlFor="notes">{t("installer_install.notes_label")}</Label>
					<Textarea
						id="notes"
						name="notes"
						rows={3}
						placeholder={t("installer_install.notes_placeholder")}
					/>
				</div>

				<Button type="submit" className="w-full">
					{online
						? t("installer_install.submit")
						: t("installer_install.save_offline")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
