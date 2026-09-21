import { PackageIcon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Spark } from "~/components/dashboard-viz"
import { EmptyState } from "~/components/ui/empty-state"
import { Box, DesignSystem, Greet, KPI, Stat, Tag } from "./primitives"

type RestockRow = {
	id: string
	status: string
	warehouse?: { name?: string } | null
}

type InstallRow = {
	id: string
	claroJobReference: string
	serviceType: string
	date: string | Date
	discrepancyFlagged: boolean
}

type ParStatus = {
	hasParLevels: boolean
	belowParCount: number
}

export function InstallerDashboardV2({
	userName,
	pendingCount,
	completedThisWeek,
	completedTrend,
	parStatus,
	restockPendingCount,
	readyForPickup,
	installLogs,
}: {
	userName: string
	pendingCount: number
	completedThisWeek: number
	completedTrend: number[]
	parStatus: ParStatus
	restockPendingCount: number
	readyForPickup: RestockRow[]
	installLogs: InstallRow[]
}) {
	const { t } = useTranslation()
	const first = userName.split(" ")[0] || userName

	return (
		<DesignSystem>
			<Greet
				title={t("ds.installer.hello", { name: first })}
				subtitle={
					pendingCount > 0
						? t("ds.installer.greet_pending", { count: pendingCount })
						: t("ds.installer.greet_clear")
				}
				actions={
					<>
						<Link to="/installer/install" className="jaf-btn jaf-sm">
							{t("installer.log_install")}
						</Link>
						<Link to="/installer/restock" className="jaf-btn jaf-blue jaf-sm">
							{t("installer.request_restock")}
						</Link>
					</>
				}
			/>

			<div className="jaf-kpis jaf-k4">
				<KPI
					label={t("ds.installer.kpi_pending")}
					value={pendingCount}
					delta={t("ds.installer.kpi_pending_delta")}
				/>
				<KPI
					label={t("ds.installer.kpi_completed")}
					value={completedThisWeek}
					viz={
						<Spark
							values={completedTrend}
							label={t("ds.installer.kpi_completed")}
						/>
					}
				/>
				{!parStatus.hasParLevels ? (
					<KPI
						label={t("ds.installer.kpi_par")}
						value="—"
						delta={t("ds.installer.kpi_par_none")}
					/>
				) : parStatus.belowParCount === 0 ? (
					<KPI
						label={t("ds.installer.kpi_par")}
						value={t("ds.installer.kpi_par_ok")}
						variant="good"
						delta={t("ds.installer.kpi_par_at_par")}
					/>
				) : (
					<KPI
						label={t("ds.installer.kpi_par")}
						value={parStatus.belowParCount}
						variant="warn"
						delta={t("ds.installer.kpi_par_below", {
							count: parStatus.belowParCount,
						})}
					/>
				)}
				<KPI
					label={t("ds.installer.kpi_restock")}
					value={restockPendingCount}
					variant={restockPendingCount > 0 ? "warn" : undefined}
				/>
			</div>

			<div className="jaf-grid">
				<Box span={4} accent glance>
					<h2>{t("ds.installer.today")}</h2>
					{pendingCount === 0 ? (
						<>
							<div className="jaf-big">0</div>
							<p>{t("ds.installer.greet_clear")}</p>
						</>
					) : (
						<>
							<div className="jaf-big">{readyForPickup.length}</div>
							<p>
								{t("ds.installer.ready_pickup", {
									count: readyForPickup.length,
								})}
							</p>
							<Link to="/installer/adjust" className="jaf-btn jaf-acc">
								{t("installer.adjust_stock")}
							</Link>
						</>
					)}
				</Box>

				<Box span={8}>
					<h2>{t("ds.installer.queue")}</h2>
					<p className="jaf-sub">{t("ds.installer.queue_sub")}</p>
					{installLogs.length === 0 ? (
						<EmptyState
							icon={PackageIcon}
							title={t("ds.installer.no_installs")}
						/>
					) : (
						<table>
							<thead>
								<tr>
									<th>{t("ds.installer.col_ref")}</th>
									<th>{t("ds.installer.col_type")}</th>
									<th>{t("ds.installer.col_date")}</th>
									<th className="jaf-act">{t("ds.installer.col_status")}</th>
								</tr>
							</thead>
							<tbody>
								{installLogs.map((log) => (
									<tr key={log.id}>
										<td className="jaf-mono">{log.claroJobReference}</td>
										<td>{log.serviceType}</td>
										<td className="jaf-sm">
											{new Date(log.date).toLocaleDateString()}
										</td>
										<td className="jaf-act">
											{log.discrepancyFlagged ? (
												<Tag tone="warn">{t("installer.discrepancy")}</Tag>
											) : (
												<Tag tone="ok">{t("ds.installer.logged")}</Tag>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<div className="jaf-split">
						<Stat
							label={t("ds.installer.kpi_restock")}
							value={restockPendingCount}
						/>
						<Stat
							label={t("ds.installer.ready_stat")}
							value={readyForPickup.length}
						/>
					</div>
				</Box>
			</div>
		</DesignSystem>
	)
}

export function InstallerNoVanV2() {
	const { t } = useTranslation()
	return (
		<DesignSystem>
			<Greet title={t("installer.title")} subtitle={t("installer.no_van")} />
			<Box span={12}>
				<EmptyState
					icon={PackageIcon}
					title={t("installer.no_van")}
					description={t("installer.no_van_hint")}
				/>
			</Box>
		</DesignSystem>
	)
}
