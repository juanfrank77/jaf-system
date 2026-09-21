import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { useOnline } from "~/hooks/use-online"
import { queueInstallerRestock } from "~/lib/installer-sync"
import type { AdjustInventoryRow } from "./installer-adjust"
import { ParStatusBanner } from "./installer-par-banner"
import {
	Back,
	Box,
	DesignSystem,
	DsButton,
	Field,
	Gate,
	Greet,
	Note,
	Tag,
} from "./primitives"

export type RestockRequestRow = {
	id: string
	status: string
	warehouse?: { name?: string | null } | null
}

function parseRequestQty(raw: string): number | null {
	if (raw.trim() === "") return 0
	const qty = Number.parseInt(raw, 10)
	if (Number.isNaN(qty) || qty < 0) return null
	return qty
}

export function buildRestockSubmitState({
	warehouseId,
	qtyByRow,
	comparison,
}: {
	warehouseId: string
	qtyByRow: Record<string, string>
	comparison: AdjustInventoryRow[]
}) {
	const positiveLines = comparison.filter(
		(row) => (parseRequestQty(qtyByRow[row.serviceCodeId] ?? "") ?? 0) > 0,
	)
	const invalidQty = comparison.some((row) => {
		const parsed = parseRequestQty(qtyByRow[row.serviceCodeId] ?? "")
		return parsed === null
	})
	return {
		hasWarehouse: warehouseId.trim().length > 0,
		hasPositiveQty: positiveLines.length > 0,
		allQtyValid: !invalidQty,
		canSubmit:
			warehouseId.trim().length > 0 && positiveLines.length > 0 && !invalidQty,
		items: positiveLines.map((row) => ({
			serviceCodeId: row.serviceCodeId,
			qty: parseRequestQty(qtyByRow[row.serviceCodeId] ?? "") ?? 0,
		})),
	}
}

const RESTOCK_STATUS_LABEL_KEY: Record<string, string> = {
	REQUESTED: "installer.status.requested",
	PENDING_APPROVAL: "installer.status.pending_approval",
	APPROVED: "installer.status.approved",
	DENIED: "installer.status.denied",
	READY: "installer.status.ready",
	FULFILLED: "installer.status.fulfilled",
}

function restockStatusTone(
	status: string,
): "default" | "ok" | "warn" | "crit" | "acc" {
	switch (status) {
		case "READY":
		case "APPROVED":
		case "FULFILLED":
			return "ok"
		case "PENDING_APPROVAL":
			return "warn"
		case "DENIED":
			return "crit"
		default:
			return "acc"
	}
}

export function InstallerRestockV2({
	van,
	warehouses,
	comparison,
	parStatus,
	hasPendingRestock,
	pendingRequestCount,
	restockRequests,
	errorKey,
}: {
	van: { id: string; name: string }
	warehouses: { id: string; name: string }[]
	comparison: AdjustInventoryRow[]
	parStatus: { hasParLevels: boolean; belowParCount: number }
	hasPendingRestock: boolean
	pendingRequestCount: number
	restockRequests: RestockRequestRow[]
	errorKey: string | null
}) {
	const { t } = useTranslation()
	const online = useOnline()
	const [queued, setQueued] = useState(false)
	const [warehouseId, setWarehouseId] = useState("")
	const [qtyByRow, setQtyByRow] = useState<Record<string, string>>({})

	const submitState = buildRestockSubmitState({
		warehouseId,
		qtyByRow,
		comparison,
	})

	const greetSubtitle = useMemo(() => {
		const parts: string[] = []
		if (parStatus.belowParCount > 0) {
			parts.push(
				t("ds.installer.restock_greet_below", {
					count: parStatus.belowParCount,
				}),
			)
		}
		if (pendingRequestCount > 0) {
			parts.push(
				t("ds.installer.restock_greet_pending", {
					count: pendingRequestCount,
				}),
			)
		}
		if (parts.length === 0) {
			return t("ds.installer.restock_greet_clear", { vanName: van.name })
		}
		return parts.join(" · ")
	}, [parStatus.belowParCount, pendingRequestCount, t, van.name])

	const gateItems = useMemo(() => {
		const items: {
			id: string
			ok: boolean | "warn"
			label: string
		}[] = []
		items.push({
			id: "warehouse",
			ok: submitState.hasWarehouse,
			label: submitState.hasWarehouse
				? t("ds.installer.restock_gate_warehouse_ok")
				: t("ds.installer.restock_gate_warehouse"),
		})
		items.push({
			id: "qty",
			ok: submitState.hasPositiveQty && submitState.allQtyValid,
			label: !submitState.allQtyValid
				? t("ds.installer.restock_gate_qty_invalid")
				: submitState.hasPositiveQty
					? t("ds.installer.restock_gate_qty_ok")
					: t("ds.installer.restock_gate_qty"),
		})
		return items
	}, [submitState, t])

	const openRequests = restockRequests.filter((r) => r.status !== "FULFILLED")

	return (
		<DesignSystem constrain>
			<Back to="/installer">← {t("ds.back")}</Back>
			<Greet title={t("installer_restock.title")} subtitle={greetSubtitle} />

			<ParStatusBanner
				parStatus={parStatus}
				hasPendingRestock={hasPendingRestock}
			/>

			{errorKey ? <Note tone="crit">{t(errorKey as never)}</Note> : null}

			{queued ? (
				<Note tone="ok">{t("ds.installer.restock_offline_saved")}</Note>
			) : null}

			{!online && !queued ? (
				<Note tone="warn">{t("installer_restock.offline_submit_notice")}</Note>
			) : null}

			{comparison.length === 0 ? (
				<Box span={12}>
					<p className="jaf-sub">{t("ds.installer.restock_empty_materials")}</p>
					<div className="jaf-actions" style={{ marginTop: 12 }}>
						<Link to="/installer" className="jaf-btn jaf-ghost">
							{t("ds.back")}
						</Link>
					</div>
				</Box>
			) : (
				<Form
					method="post"
					className="jaf-grid"
					onSubmit={(e) => {
						if (!online) {
							e.preventDefault()
							if (!submitState.canSubmit) return
							queueInstallerRestock({
								warehouseId,
								items: submitState.items,
							}).then(() => setQueued(true))
						}
					}}
				>
					<Box span={12}>
						<Field
							label={t("installer_restock.warehouse_label")}
							htmlFor="warehouseId"
						>
							<select
								id="warehouseId"
								name="warehouseId"
								required
								className="jaf-inp"
								value={warehouseId}
								onChange={(e) => setWarehouseId(e.target.value)}
							>
								<option value="">
									{t("installer_restock.warehouse_placeholder")}
								</option>
								{warehouses.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name}
									</option>
								))}
							</select>
						</Field>
					</Box>

					<Box span={12}>
						<h2 className="jaf-sub" style={{ marginBottom: 8 }}>
							{t("installer_restock.items_label")}
						</h2>
						<input
							type="hidden"
							name="items"
							value={JSON.stringify(submitState.items)}
						/>
						<div className="jaf-tblwrap">
							<table>
								<thead>
									<tr>
										<th>{t("ds.installer.restock_col_material")}</th>
										<th>{t("ds.installer.adjust_col_par")}</th>
										<th>{t("ds.installer.adjust_col_on_hand")}</th>
										<th>{t("ds.installer.restock_col_request")}</th>
									</tr>
								</thead>
								<tbody>
									{comparison.map((row) => {
										const belowPar =
											row.standard > 0 && row.onHand < row.standard
										return (
											<tr key={row.serviceCodeId}>
												<td>
													<div>{row.name}</div>
													<div className="jaf-sub">{row.claroCode}</div>
												</td>
												<td>{row.standard}</td>
												<td>{row.onHand}</td>
												<td>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: 8,
															flexWrap: "wrap",
														}}
													>
														<input
															type="number"
															min={0}
															inputMode="numeric"
															className="jaf-inp jaf-qty"
															style={{ minHeight: 44 }}
															aria-label={t("ds.installer.restock_qty_for", {
																material: row.name,
															})}
															value={qtyByRow[row.serviceCodeId] ?? ""}
															onChange={(e) =>
																setQtyByRow((prev) => ({
																	...prev,
																	[row.serviceCodeId]: e.target.value,
																}))
															}
														/>
														{belowPar ? (
															<Tag tone="warn">
																{t("ds.installer.adjust_below_par")}
															</Tag>
														) : null}
													</div>
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					</Box>

					<Box span={12}>
						<Gate items={gateItems} live />
						<DsButton
							type="submit"
							className="jaf-blue"
							style={{ width: "100%", minHeight: 44, marginTop: 12 }}
							disabled={!submitState.canSubmit || queued}
						>
							{online
								? t("installer_restock.submit")
								: t("installer_restock.save_offline")}
						</DsButton>
					</Box>
				</Form>
			)}

			<Box span={12}>
				<h2 className="jaf-sub" style={{ marginBottom: 8 }}>
					{t("ds.installer.restock_my_requests")}
				</h2>
				{openRequests.length === 0 ? (
					<>
						<p className="jaf-sub">{t("ds.installer.restock_no_requests")}</p>
						{comparison.length > 0 ? (
							<div className="jaf-actions" style={{ marginTop: 12 }}>
								<span className="jaf-sub">
									{t("ds.installer.restock_no_requests_hint")}
								</span>
							</div>
						) : null}
					</>
				) : (
					<div className="jaf-tblwrap">
						<table>
							<thead>
								<tr>
									<th>{t("ds.installer.restock_col_request")}</th>
									<th>{t("ds.installer.restock_col_warehouse")}</th>
									<th>{t("ds.installer.adjust_col_status")}</th>
								</tr>
							</thead>
							<tbody>
								{openRequests.map((req) => {
									const labelKey = RESTOCK_STATUS_LABEL_KEY[req.status]
									const label = labelKey ? t(labelKey as never) : req.status
									const idCell =
										req.status === "READY" ? (
											<Link to={`/restock/${req.id}/pickup`}>
												#{req.id.slice(-6)}
											</Link>
										) : (
											<>#{req.id.slice(-6)}</>
										)
									return (
										<tr key={req.id}>
											<td className="jaf-mono">{idCell}</td>
											<td>{req.warehouse?.name ?? "—"}</td>
											<td>
												<Tag tone={restockStatusTone(req.status)}>{label}</Tag>
												{req.status === "READY" ? (
													<>
														{" "}
														<Link
															to={`/restock/${req.id}/pickup`}
															className="jaf-back"
															style={{ display: "inline", marginLeft: 8 }}
														>
															{t("ds.installer.restock_pickup_link")}
														</Link>
													</>
												) : null}
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				)}
			</Box>
		</DesignSystem>
	)
}
