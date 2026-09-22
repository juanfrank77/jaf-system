import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { InstallerRestockV2 } from "~/components/design-system/installer-restock"
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
import { useOnline } from "~/hooks/use-online"
import { db } from "~/lib/db.server"
import { isInstallerV2Enabled } from "~/lib/features.server"
import { queueInstallerRestock } from "~/lib/installer-sync"
import { requireRole } from "~/lib/permissions.server"
import {
	buildInventoryComparison,
	buildRestockPrefillMap,
	evaluateRestockApproval,
} from "~/lib/van-inventory"
import {
	computeParStatus,
	getVanParLevels,
	parLevelsToStockLevels,
} from "~/lib/van-stock.server"
import type { Route } from "./+types/_app.installer.restock"

export const meta: Route.MetaFunction = () => [
	{ title: "Request Restock — JAF Ops" },
]

const ACTIVE_RESTOCK_STATUSES = [
	"REQUESTED",
	"PENDING_APPROVAL",
	"APPROVED",
	"READY",
] as const

const PENDING_RESTOCK_STATUSES = [
	"REQUESTED",
	"PENDING_APPROVAL",
	"APPROVED",
] as const

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const [van, warehouses, serviceCodes] = await Promise.all([
		db.van.findUnique({ where: { installerId: user.id } }),
		db.warehouse.findMany({ where: { active: true } }),
		db.serviceCode.findMany({
			where: { active: true },
			orderBy: { claroCode: "asc" },
		}),
	])
	if (!van) throw redirect("/installer")

	const [
		transactions,
		parLevels,
		restockRequests,
		pendingRestock,
		pendingForPrefill,
	] = await Promise.all([
		db.vanInventoryTransaction.findMany({ where: { vanId: van.id } }),
		getVanParLevels(van.id),
		db.vanRestockRequest.findMany({
			where: { requestedById: user.id },
			orderBy: { createdAt: "desc" },
			take: 20,
			include: { warehouse: true },
		}),
		db.vanRestockRequest.findFirst({
			where: {
				requestedById: user.id,
				status: { in: [...ACTIVE_RESTOCK_STATUSES] },
			},
			select: { id: true },
		}),
		db.vanRestockRequest.findMany({
			where: {
				requestedById: user.id,
				status: { in: [...PENDING_RESTOCK_STATUSES] },
			},
			select: { items: true },
		}),
	])

	const serviceCodeMap = new Map(
		serviceCodes.map((c) => [c.id, { claroCode: c.claroCode, name: c.name }]),
	)
	const stockLevels = parLevelsToStockLevels(parLevels)
	const comparison = buildInventoryComparison(
		transactions,
		stockLevels,
		serviceCodeMap,
	)
	const pendingItems = (
		pendingForPrefill as { items: { serviceCodeId: string; qty: number }[] }[]
	).flatMap((r) =>
		(r.items || []).map((i) => ({
			serviceCodeId: i.serviceCodeId,
			qty: i.qty,
			type: "RESTOCK" as const,
		})),
	)
	const prefillByRow = buildRestockPrefillMap(
		[...transactions, ...pendingItems],
		stockLevels,
	)
	const parStatus = computeParStatus({ parLevels, transactions })
	const pendingRequestCount = restockRequests.filter((r) =>
		(PENDING_RESTOCK_STATUSES as readonly string[]).includes(r.status),
	).length

	return {
		version: isInstallerV2Enabled() ? "v2" : "v1",
		van,
		warehouses,
		serviceCodes,
		comparison,
		parLevels,
		parStatus,
		hasPendingRestock: pendingRestock != null,
		pendingRequestCount,
		restockRequests,
		prefillByRow,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const van = await db.van.findUnique({ where: { installerId: user.id } })
	if (!van) {
		return data(
			{ errorKey: "installer_restock.errors.no_van" },
			{ status: 400 },
		)
	}

	const form = await request.formData()
	const warehouseId = (form.get("warehouseId") as string | null)?.trim() || ""
	const itemsRaw = form.get("items") as string

	if (!warehouseId) {
		return data(
			{ errorKey: "installer_restock.errors.warehouse_required" },
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
			{ errorKey: "installer_restock.errors.invalid_items" },
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
			{ errorKey: "installer_restock.errors.invalid_service_codes" },
			{ status: 400 },
		)
	}

	if (items.length === 0) {
		return data(
			{ errorKey: "installer_restock.errors.items_required" },
			{ status: 400 },
		)
	}

	if (request.headers.get("X-Offline-Sync") === "true") {
		if (!van.active) {
			return data({ conflict: "VAN_INACTIVE" }, { status: 409 })
		}
		const warehouse = await db.warehouse.findUnique({
			where: { id: warehouseId },
		})
		if (!warehouse?.active) {
			return data({ conflict: "WAREHOUSE_INACTIVE" }, { status: 409 })
		}
	}

	const transactions = await db.$queryRaw<
		{ serviceCodeId: string; qty: number }[]
	>`
		SELECT serviceCodeId, SUM(qty) as qty
		FROM "VanInventoryTransaction"
		WHERE vanId = ${van.id}
		GROUP BY serviceCodeId
	`

	const [pendingRequests] = await Promise.all([
		db.vanRestockRequest.findMany({
			where: {
				requestedById: user.id,
				status: { in: ["REQUESTED", "PENDING_APPROVAL", "APPROVED"] },
			},
			select: { items: true },
		}),
	])

	const pendingItems = (
		pendingRequests as { items: { serviceCodeId: string; qty: number }[] }[]
	).flatMap((r) =>
		(r.items || []).map((i) => ({ ...i, type: "RESTOCK" as const })),
	)

	const allTransactions = [
		...transactions.map((t) => ({
			serviceCodeId: t.serviceCodeId,
			qty: t.qty,
			type: "RESTOCK" as const,
		})),
		...pendingItems,
	]

	const parLevels = await getVanParLevels(van.id)
	const { requiresApproval } = evaluateRestockApproval(
		items,
		allTransactions,
		parLevelsToStockLevels(parLevels),
	)

	const status = requiresApproval ? "PENDING_APPROVAL" : "REQUESTED"

	const restockRequest = await db.vanRestockRequest.create({
		data: {
			requestedById: user.id,
			warehouseId,
			items,
			status,
			requiresApproval,
		},
	})

	const recipients = await db.user.findMany({
		where: {
			role: requiresApproval ? { in: ["SUPERVISOR", "ADMIN"] } : "WAREHOUSE",
			active: true,
		},
	})
	const message = requiresApproval
		? `Restock request #${restockRequest.id.slice(-6)} from ${van.name} requires approval.`
		: `New restock request #${restockRequest.id.slice(-6)} from ${van.name} is ready to fulfill.`

	await db.$transaction([
		...recipients.map((u: { id: string }) =>
			db.notification.create({
				data: { userId: u.id, message },
			}),
		),
	])

	throw redirect("/installer")
}

export default function RequestRestock({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		version,
		van,
		warehouses,
		serviceCodes,
		comparison,
		parStatus,
		hasPendingRestock,
		pendingRequestCount,
		restockRequests,
		prefillByRow = {},
	} = loaderData
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

	if (version === "v2") {
		return (
			<InstallerRestockV2
				van={van}
				warehouses={warehouses}
				comparison={comparison}
				parStatus={parStatus}
				hasPendingRestock={hasPendingRestock}
				pendingRequestCount={pendingRequestCount}
				restockRequests={restockRequests}
				prefillByRow={prefillByRow}
				errorKey={errorKey}
			/>
		)
	}

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

	const used = new Set(lines.map((l) => l.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter((c) => !used.has(c.id))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("installer_restock.title")}</h1>

			{errorKey && (
				<p className="text-sm text-red-600">{t(errorKey as never)}</p>
			)}

			{queued && (
				<div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
					{t("installer_restock.queued_message")}
				</div>
			)}

			{!online && !queued && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
					{t("installer_restock.offline_submit_notice")}
				</div>
			)}

			<Form
				method="post"
				className="space-y-4"
				onSubmit={(e) => {
					if (!online) {
						e.preventDefault()
						const form = e.currentTarget
						const formData = new FormData(form)
						const warehouseId =
							(formData.get("warehouseId") as string | null)?.trim() || ""
						const itemsRaw = formData.get("items") as string
						let items: { serviceCodeId: string; qty: number }[] = []
						try {
							items = JSON.parse(itemsRaw).filter(
								(i: { serviceCodeId: string; qty: number }) =>
									i.serviceCodeId && i.qty > 0,
							)
						} catch {
							// ignore, validation happens on sync
						}
						queueInstallerRestock({ warehouseId, items }).then(() =>
							setQueued(true),
						)
					}
				}}
			>
				<div>
					<Label htmlFor="warehouseId">
						{t("installer_restock.warehouse_label")}
					</Label>
					<Select name="warehouseId" required>
						<SelectTrigger id="warehouseId" className="mt-1">
							<SelectValue
								placeholder={t("installer_restock.warehouse_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{warehouses.map((w: { id: string; name: string }) => (
								<SelectItem key={w.id} value={w.id}>
									{w.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label>{t("installer_restock.items_label")}</Label>
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
											placeholder={t("installer_restock.item_placeholder")}
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
						{t("installer_restock.add_item")}
					</Button>
				</div>

				<Button type="submit" className="w-full">
					{online
						? t("installer_restock.submit")
						: t("installer_restock.save_offline")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
