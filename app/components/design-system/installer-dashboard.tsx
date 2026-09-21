import { PackageIcon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Spark } from "~/components/dashboard-viz"
import { EmptyState } from "~/components/ui/empty-state"
import {
	Box,
	DesignSystem,
	DsButton,
	Greet,
	KPI,
	Stat,
	Tag,
} from "./primitives"

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

export function InstallerAdjustV2({
	serviceCodes,
	errorKey,
	belowParCount,
}: {
	serviceCodes: { id: string; claroCode: string; name: string }[]
	errorKey: string | null
	belowParCount: number
}) {
	const { t } = useTranslation()
	return (
		<DesignSystem>
			<BackStub />
			<Greet
				title={t("installer_adjust.title")}
				subtitle={t("ds.installer.adjust_sub")}
			/>
			{belowParCount > 0 ? (
				<NoteBanner
					text={t("ds.installer.below_par", { count: belowParCount })}
				/>
			) : (
				<NoteBanner tone="acc" text={t("ds.installer.par_unwired_note")} />
			)}
			<Box span={12}>
				{errorKey ? (
					<NoteBanner tone="crit" text={t(errorKey as never)} />
				) : null}
				<Form
					method="post"
					className="jaf-form2"
					style={{ display: "grid", gap: 12 }}
				>
					<div className="jaf-field">
						<label htmlFor="serviceCodeId">
							{t("installer_adjust.material_label")}
						</label>
						<select
							id="serviceCodeId"
							name="serviceCodeId"
							required
							className="jaf-inp"
						>
							<option value="">
								{t("installer_adjust.material_placeholder")}
							</option>
							{serviceCodes.map((c) => (
								<option key={c.id} value={c.id}>
									{c.claroCode} — {c.name}
								</option>
							))}
						</select>
					</div>
					<div className="jaf-field">
						<label htmlFor="qty">{t("installer_adjust.qty_label")}</label>
						<input
							id="qty"
							name="qty"
							type="number"
							min={1}
							required
							className="jaf-inp jaf-qty"
							placeholder={t("installer_adjust.qty_placeholder")}
						/>
					</div>
					<div className="jaf-field" style={{ gridColumn: "1 / -1" }}>
						<label htmlFor="note">{t("installer_adjust.note_label")}</label>
						<textarea
							id="note"
							name="note"
							rows={3}
							required
							className="jaf-inp"
							placeholder={t("installer_adjust.note_placeholder")}
						/>
					</div>
					<div className="jaf-actions">
						<DsButton type="submit">{t("installer_adjust.submit")}</DsButton>
						<Link to="/installer" className="jaf-btn jaf-ghost">
							{t("ds.cancel")}
						</Link>
					</div>
				</Form>
			</Box>
		</DesignSystem>
	)
}

function NoteBanner({
	text,
	tone = "warn",
}: {
	text: string
	tone?: "warn" | "crit" | "ok" | "acc"
}) {
	return <div className={cnNote(tone)}>{text}</div>
}

function cnNote(tone: "warn" | "crit" | "ok" | "acc") {
	return tone === "warn" ? "jaf-note" : `jaf-note jaf-${tone}`
}

function BackStub() {
	const { t } = useTranslation()
	return (
		<Link to="/installer" className="jaf-back">
			← {t("ds.back")}
		</Link>
	)
}
