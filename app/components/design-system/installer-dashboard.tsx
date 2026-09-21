import { PackageIcon } from "@hugeicons/core-free-icons"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Spark } from "~/components/dashboard-viz"
import { EmptyState } from "~/components/ui/empty-state"
import type { ParLevel } from "~/lib/van-stock"
import {
	Back,
	Box,
	DesignSystem,
	DsButton,
	Field,
	Gate,
	Greet,
	KPI,
	Note,
	Stat,
	Tag,
} from "./primitives"

type InventoryRow = {
	serviceCodeId: string
	claroCode: string
	name: string
	onHand: number
	standard: number
	delta: number
}

type AdjustParStatus = {
	hasParLevels: boolean
	belowParCount: number
}

const SERIAL_NAME_PATTERN = /\b(modem|ont|gateway|router)\b/i

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
	van,
	comparison,
	parLevels,
	parStatus,
	hasPendingRestock,
	errorKey,
}: {
	van: { id: string; name: string }
	comparison: InventoryRow[]
	parLevels: ParLevel[]
	parStatus: AdjustParStatus
	hasPendingRestock: boolean
	errorKey: string | null
}) {
	const { t } = useTranslation()
	const parCodeIds = useMemo(
		() => new Set(parLevels.map((level) => level.serviceCodeId)),
		[parLevels],
	)
	const [adjustQtys, setAdjustQtys] = useState<Record<string, string>>({})
	const [note, setNote] = useState("")

	const filledRows = useMemo(
		() =>
			comparison.filter((row) => {
				const raw = adjustQtys[row.serviceCodeId]
				if (!raw?.trim()) return false
				const qty = Number.parseInt(raw, 10)
				return !Number.isNaN(qty) && qty > 0
			}),
		[comparison, adjustQtys],
	)

	const selectedRow = filledRows.length === 1 ? filledRows[0] : null
	const selectedQty = selectedRow
		? Number.parseInt(adjustQtys[selectedRow.serviceCodeId] ?? "0", 10)
		: 0

	const gateItems = useMemo(() => {
		const items: {
			id: string
			ok: boolean | "warn"
			label: string
			detail?: string
		}[] = []
		if (filledRows.length === 0) {
			items.push({
				id: "material",
				ok: false,
				label: t("ds.installer.adjust_gate_material"),
			})
		} else if (filledRows.length > 1) {
			items.push({
				id: "one_line",
				ok: false,
				label: t("ds.installer.adjust_gate_one_line"),
			})
		} else {
			items.push({
				id: "material",
				ok: true,
				label: t("ds.installer.adjust_gate_material_ok"),
			})
		}
		if (!note.trim()) {
			items.push({
				id: "note",
				ok: false,
				label: t("ds.installer.adjust_gate_note"),
			})
		} else {
			items.push({
				id: "note",
				ok: true,
				label: t("ds.installer.adjust_gate_note_ok"),
			})
		}
		return items
	}, [filledRows.length, note, t])

	const canSave = gateItems.every((item) => item.ok === true)

	const greetSubtitle = !parStatus.hasParLevels
		? t("ds.installer.adjust_greet_no_par", { vanName: van.name })
		: parStatus.belowParCount > 0
			? t("ds.installer.adjust_greet_below_par", {
					vanName: van.name,
					count: parStatus.belowParCount,
				})
			: t("ds.installer.adjust_greet_at_par", { vanName: van.name })

	const hasSerialLikeMaterial = comparison.some((row) =>
		SERIAL_NAME_PATTERN.test(row.name),
	)

	function handleAdjustChange(serviceCodeId: string, value: string) {
		setAdjustQtys((prev) => {
			const next = { ...prev }
			if (!value.trim()) {
				delete next[serviceCodeId]
				return next
			}
			for (const key of Object.keys(next)) {
				if (key !== serviceCodeId) delete next[key]
			}
			next[serviceCodeId] = value
			return next
		})
	}

	function rowStatus(row: InventoryRow) {
		if (!parCodeIds.has(row.serviceCodeId)) {
			return {
				tone: "default" as const,
				label: t("ds.installer.adjust_no_par"),
			}
		}
		if (row.onHand < row.standard) {
			return {
				tone: "warn" as const,
				label: t("ds.installer.adjust_below_par"),
			}
		}
		return { tone: "ok" as const, label: t("ds.installer.adjust_at_par") }
	}

	return (
		<DesignSystem>
			<Back to="/installer">← {t("ds.back")}</Back>
			<Greet title={t("installer_adjust.title")} subtitle={greetSubtitle} />

			<ParStatusBanner
				parStatus={parStatus}
				hasPendingRestock={hasPendingRestock}
			/>

			{hasSerialLikeMaterial ? (
				<Note tone="acc">{t("ds.installer.adjust_serial_unwired")}</Note>
			) : null}

			{errorKey ? <Note tone="crit">{t(errorKey as never)}</Note> : null}

			{comparison.length === 0 ? (
				<Box span={12}>
					<p className="jaf-sub">{t("ds.installer.adjust_empty_body")}</p>
					<div className="jaf-actions" style={{ marginTop: 12 }}>
						<Link to="/installer/restock" className="jaf-btn jaf-blue">
							{t("installer.request_restock")}
						</Link>
						<Link to="/installer" className="jaf-btn jaf-ghost">
							{t("ds.back")}
						</Link>
					</div>
				</Box>
			) : (
				<Box span={12}>
					<div className="jaf-tblwrap">
						<table>
							<thead>
								<tr>
									<th>{t("ds.installer.adjust_col_material")}</th>
									<th>{t("ds.installer.adjust_col_par")}</th>
									<th>{t("ds.installer.adjust_col_on_hand")}</th>
									<th>{t("ds.installer.adjust_col_adjust")}</th>
									<th>{t("ds.installer.adjust_col_status")}</th>
								</tr>
							</thead>
							<tbody>
								{comparison.map((row) => {
									const status = rowStatus(row)
									const inputId = `adjust-${row.serviceCodeId}`
									return (
										<tr key={row.serviceCodeId}>
											<td>
												<span className="jaf-mono">{row.claroCode}</span>
												<span className="jaf-sub"> — {row.name}</span>
											</td>
											<td>
												<input
													className="jaf-inp ro jaf-qty"
													readOnly
													tabIndex={-1}
													value={
														parCodeIds.has(row.serviceCodeId)
															? row.standard
															: "—"
													}
													aria-label={t("ds.installer.adjust_col_par")}
												/>
											</td>
											<td>
												<input
													className="jaf-inp ro jaf-qty"
													readOnly
													tabIndex={-1}
													value={row.onHand}
													aria-label={t("ds.installer.adjust_col_on_hand")}
												/>
											</td>
											<td>
												<input
													id={inputId}
													type="number"
													min={1}
													className="jaf-inp jaf-qty"
													inputMode="numeric"
													value={adjustQtys[row.serviceCodeId] ?? ""}
													onChange={(e) =>
														handleAdjustChange(
															row.serviceCodeId,
															e.target.value,
														)
													}
													aria-label={t("ds.installer.adjust_qty_aria", {
														material: row.name,
													})}
												/>
											</td>
											<td>
												<Tag tone={status.tone}>{status.label}</Tag>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>

					<Form method="post" className="jaf-form2" style={{ marginTop: 16 }}>
						{selectedRow ? (
							<>
								<input
									type="hidden"
									name="serviceCodeId"
									value={selectedRow.serviceCodeId}
								/>
								<input type="hidden" name="qty" value={selectedQty} />
							</>
						) : null}
						<Field label={t("installer_adjust.note_label")} htmlFor="note">
							<textarea
								id="note"
								name="note"
								rows={3}
								required
								className="jaf-inp"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder={t("installer_adjust.note_placeholder")}
							/>
						</Field>

						<Gate items={gateItems} />

						<div className="jaf-actions">
							<DsButton type="submit" disabled={!canSave}>
								{t("installer_adjust.submit")}
							</DsButton>
							<Link to="/installer" className="jaf-btn jaf-ghost">
								{t("ds.cancel")}
							</Link>
						</div>
					</Form>
				</Box>
			)}
		</DesignSystem>
	)
}

function ParStatusBanner({
	parStatus,
	hasPendingRestock,
}: {
	parStatus: AdjustParStatus
	hasPendingRestock: boolean
}) {
	const { t } = useTranslation()

	if (!parStatus.hasParLevels) {
		return <Note tone="acc">{t("ds.installer.adjust_banner_no_par")}</Note>
	}

	if (parStatus.belowParCount === 0) {
		return <Note tone="ok">{t("ds.installer.adjust_banner_at_par")}</Note>
	}

	if (hasPendingRestock) {
		return (
			<Note tone="warn">
				{t("ds.installer.adjust_banner_below_restock_pending", {
					count: parStatus.belowParCount,
				})}
			</Note>
		)
	}

	return (
		<Note tone="warn">
			{t("ds.installer.adjust_banner_below_restock_link", {
				count: parStatus.belowParCount,
			})}{" "}
			<Link to="/installer/restock">{t("installer.request_restock")}</Link>
		</Note>
	)
}
