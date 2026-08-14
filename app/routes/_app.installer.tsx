import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { buildInventoryComparison, type StockLevel } from "~/lib/van-inventory"
import type { Route } from "./+types/_app.installer"

export const meta: Route.MetaFunction = () => [
	{ title: "Installer Portal — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const van = await db.van.findUnique({
		where: { installerId: user.id },
	})

	const [restockRequests, installLogs, serviceCodes] = await Promise.all([
		db.vanRestockRequest.findMany({
			where: { requestedById: user.id },
			orderBy: { createdAt: "desc" },
			take: 20,
			include: { warehouse: true },
		}),
		db.installLog.findMany({
			where: { installerId: user.id },
			orderBy: { date: "desc" },
			take: 20,
		}),
		db.serviceCode.findMany({ where: { active: true } }),
	])

	const transactions = van
		? await db.vanInventoryTransaction.findMany({
				where: { vanId: van.id },
				orderBy: { createdAt: "desc" },
			})
		: []

	const serviceCodeMap = new Map(
		serviceCodes.map((c) => [c.id, { claroCode: c.claroCode, name: c.name }]),
	)
	const inventoryComparison = van
		? buildInventoryComparison(
				transactions,
				(van.standardStockLevels as StockLevel[]) || [],
				serviceCodeMap,
			)
		: []

	return {
		user,
		van,
		restockRequests,
		installLogs,
		inventoryComparison,
		serviceCodes,
	}
}

export default function InstallerPortal({ loaderData }: Route.ComponentProps) {
	const { van, restockRequests, installLogs, inventoryComparison } = loaderData
	const { t } = useTranslation()

	if (!van) {
		return (
			<div className="space-y-4">
				<h1 className="text-xl font-semibold">{t("installer.title")}</h1>
				<p className="text-sm text-slate-500">{t("installer.no_van")}</p>
			</div>
		)
	}

	const pendingRequests = restockRequests.filter((r: { status: string }) =>
		["REQUESTED", "PENDING_APPROVAL", "APPROVED", "READY"].includes(r.status),
	)
	const readyForPickup = restockRequests.filter(
		(r: { status: string }) => r.status === "READY",
	)

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("installer.title")}</h1>
				<div className="flex gap-2">
					<Link
						to="/installer/restock"
						className={buttonVariants({ size: "sm" })}
					>
						{t("installer.request_restock")}
					</Link>
					<Link
						to="/installer/install"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("installer.log_install")}
					</Link>
				</div>
			</div>

			<section className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="text-sm font-semibold text-slate-700">
					{t("installer.my_van_heading")}
				</h2>
				{inventoryComparison.length === 0 ? (
					<p className="text-sm text-slate-400">
						{t("installer.no_inventory")}
					</p>
				) : (
					<ul className="space-y-2">
						{inventoryComparison.map(
							(item: {
								serviceCodeId: string
								claroCode: string
								name: string
								onHand: number
								standard: number
							}) => (
								<li
									key={item.serviceCodeId}
									className="flex items-center justify-between text-sm"
								>
									<span>
										{item.claroCode} — {item.name}
									</span>
									<span className="flex items-center gap-2">
										<span className="text-slate-500">
											{item.onHand} / {item.standard}
										</span>
										{item.onHand < item.standard && (
											<Badge variant="warn">{t("installer.low_stock")}</Badge>
										)}
									</span>
								</li>
							),
						)}
					</ul>
				)}
				<Link
					to="/installer/adjust"
					className={buttonVariants({
						variant: "outline",
						size: "sm",
						className: "w-full",
					})}
				>
					{t("installer.adjust_stock")}
				</Link>
			</section>

			{readyForPickup.length > 0 && (
				<section className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-semibold text-blue-800">
						{t("installer.ready_for_pickup_heading", {
							count: readyForPickup.length,
						})}
					</h2>
					{readyForPickup.map(
						(req: { id: string; warehouse?: { name?: string } | null }) => (
							<Link
								key={req.id}
								to={`/restock/${req.id}/pickup`}
								className="block text-sm font-medium text-blue-700 hover:underline"
							>
								#{req.id.slice(-6)} — {req.warehouse?.name}
							</Link>
						),
					)}
				</section>
			)}

			<section className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="text-sm font-semibold text-slate-700">
					{t("installer.restock_requests_heading")}
				</h2>
				{pendingRequests.length === 0 ? (
					<p className="text-sm text-slate-400">
						{t("installer.no_restock_requests")}
					</p>
				) : (
					<ul className="space-y-2">
						{pendingRequests.map((req: { id: string; status: string }) => (
							<li
								key={req.id}
								className="flex items-center justify-between text-sm"
							>
								<span>#{req.id.slice(-6)}</span>
								<Badge
									variant={
										req.status === "PENDING_APPROVAL"
											? "warn"
											: req.status === "READY"
												? "info"
												: "ok"
									}
								>
									{req.status}
								</Badge>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="text-sm font-semibold text-slate-700">
					{t("installer.installs_heading")}
				</h2>
				{installLogs.length === 0 ? (
					<p className="text-sm text-slate-400">{t("installer.no_installs")}</p>
				) : (
					<ul className="space-y-2">
						{installLogs.map(
							(log: {
								id: string
								claroJobReference: string
								serviceType: string
								date: Date
								discrepancyFlagged: boolean
							}) => (
								<li key={log.id} className="text-sm">
									<span className="font-medium">{log.claroJobReference}</span>
									<span className="text-slate-500 ml-2">
										{log.serviceType} —{" "}
										{new Date(log.date).toLocaleDateString()}
									</span>
									{log.discrepancyFlagged && (
										<Badge variant="warn" className="ml-2">
											{t("installer.discrepancy")}
										</Badge>
									)}
								</li>
							),
						)}
					</ul>
				)}
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
