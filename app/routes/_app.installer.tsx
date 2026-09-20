import { PackageIcon, TruckDeliveryIcon } from "@hugeicons/core-free-icons"
import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { PageHeader } from "~/components/ui/page-header"
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

const RESTOCK_STATUS_LABEL_KEY: Record<string, ParseKeys> = {
	REQUESTED: "installer.status.requested",
	PENDING_APPROVAL: "installer.status.pending_approval",
	APPROVED: "installer.status.approved",
	READY: "installer.status.ready",
}

export default function InstallerPortal({ loaderData }: Route.ComponentProps) {
	const { van, restockRequests, installLogs, inventoryComparison } = loaderData
	const { t } = useTranslation()

	if (!van) {
		return (
			<div>
				<PageHeader title={t("installer.title")} />
				<Card>
					<EmptyState
						icon={TruckDeliveryIcon}
						title={t("installer.no_van")}
						description={t("installer.no_van_hint")}
					/>
				</Card>
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
			<PageHeader
				title={t("installer.title")}
				subtitle={t("installer.subtitle")}
				actions={
					<>
						<Link
							to="/installer/install"
							className={buttonVariants({ variant: "secondary", size: "sm" })}
						>
							{t("installer.log_install")}
						</Link>
						<Link
							to="/installer/restock"
							className={buttonVariants({ size: "sm" })}
						>
							{t("installer.request_restock")}
						</Link>
					</>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t("installer.my_van_heading")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 pt-0">
					{inventoryComparison.length === 0 ? (
						<EmptyState
							icon={PackageIcon}
							title={t("installer.no_inventory")}
						/>
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
											<span className="tabular-nums text-muted-foreground">
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
							variant: "secondary",
							size: "sm",
							className: "w-full",
						})}
					>
						{t("installer.adjust_stock")}
					</Link>
				</CardContent>
			</Card>

			{readyForPickup.length > 0 && (
				<Card className="border-status-info/30 bg-status-info-soft">
					<CardHeader>
						<CardTitle className="text-status-info">
							{t("installer.ready_for_pickup_heading", {
								count: readyForPickup.length,
							})}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 pt-0">
						{readyForPickup.map(
							(req: { id: string; warehouse?: { name?: string } | null }) => (
								<Link
									key={req.id}
									to={`/restock/${req.id}/pickup`}
									className="block text-sm font-medium text-status-info hover:underline"
								>
									#{req.id.slice(-6)} — {req.warehouse?.name}
								</Link>
							),
						)}
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>{t("installer.restock_requests_heading")}</CardTitle>
				</CardHeader>
				<CardContent className="pt-0">
					{pendingRequests.length === 0 ? (
						<EmptyState title={t("installer.no_restock_requests")} />
					) : (
						<ul className="space-y-2">
							{pendingRequests.map((req: { id: string; status: string }) => (
								<li
									key={req.id}
									className="flex items-center justify-between text-sm"
								>
									<span className="font-mono text-xs">#{req.id.slice(-6)}</span>
									<Badge
										variant={
											req.status === "PENDING_APPROVAL"
												? "warn"
												: req.status === "READY"
													? "info"
													: "ok"
										}
									>
										{t(
											RESTOCK_STATUS_LABEL_KEY[req.status] ??
												"installer.status.requested",
										)}
									</Badge>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("installer.installs_heading")}</CardTitle>
				</CardHeader>
				<CardContent className="pt-0">
					{installLogs.length === 0 ? (
						<EmptyState title={t("installer.no_installs")} />
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
										<span className="ml-2 text-muted-foreground">
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
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
