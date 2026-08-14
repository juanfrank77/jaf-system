import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
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
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { evaluateRestockApproval, type StockLevel } from "~/lib/van-inventory"
import type { Route } from "./+types/_app.installer.restock"

export const meta: Route.MetaFunction = () => [
	{ title: "Request Restock — JAF Ops" },
]

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
	return { van, warehouses, serviceCodes }
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

	if (items.length === 0) {
		return data(
			{ errorKey: "installer_restock.errors.items_required" },
			{ status: 400 },
		)
	}

	const transactions = await db.vanInventoryTransaction.findMany({
		where: { vanId: van.id },
	})
	const { requiresApproval } = evaluateRestockApproval(
		items,
		transactions.map((t) => ({
			serviceCodeId: t.serviceCodeId,
			qty: t.qty,
			type: t.type,
		})),
		(van.standardStockLevels as StockLevel[]) || [],
	)

	const status = requiresApproval ? "PENDING_APPROVAL" : "REQUESTED"

	const recipients = await db.user.findMany({
		where: {
			role: requiresApproval ? { in: ["SUPERVISOR", "ADMIN"] } : "WAREHOUSE",
			active: true,
		},
	})
	const message = requiresApproval
		? `Restock request #... from ${van.name} requires approval.`
		: `New restock request from ${van.name} is ready to fulfill.`

	await db.$transaction([
		db.vanRestockRequest.create({
			data: {
				requestedById: user.id,
				warehouseId,
				items,
				status,
				requiresApproval,
			},
		}),
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
	const { warehouses, serviceCodes } = loaderData
	const { t } = useTranslation()
	const errorKey =
		actionData && "errorKey" in actionData
			? (actionData.errorKey as string)
			: null

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

	const used = new Set(lines.map((l) => l.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter((c) => !used.has(c.id))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("installer_restock.title")}</h1>

			{errorKey && <p className="text-sm text-red-600">{t(errorKey as any)}</p>}

			<Form method="post" className="space-y-4">
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
					{t("installer_restock.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
