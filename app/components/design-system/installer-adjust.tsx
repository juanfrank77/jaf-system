import { Fragment, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import type { ParLevel } from "~/lib/van-stock"
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

export type AdjustInventoryRow = {
	serviceCodeId: string
	claroCode: string
	name: string
	onHand: number
	standard: number
	delta: number
}

export type AdjustParStatus = {
	hasParLevels: boolean
	belowParCount: number
}

type RowDraft = { qty: string; note: string }

const emptyDraft = (): RowDraft => ({ qty: "", note: "" })

function hasDraft(draft: RowDraft | undefined) {
	if (!draft) return false
	return draft.qty.trim() !== "" || draft.note.trim() !== ""
}

function parseQty(raw: string) {
	const qty = Number.parseInt(raw, 10)
	return Number.isNaN(qty) || qty <= 0 ? null : qty
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
	comparison: AdjustInventoryRow[]
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
	const [activeRowId, setActiveRowId] = useState<string | null>(null)
	const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
	const [switchPrompt, setSwitchPrompt] = useState<{
		fromId: string
		toId: string
	} | null>(null)

	const activeDraft = activeRowId ? (drafts[activeRowId] ?? emptyDraft()) : null

	const updateDraft = useCallback((rowId: string, patch: Partial<RowDraft>) => {
		setDrafts((prev) => ({
			...prev,
			[rowId]: { ...emptyDraft(), ...prev[rowId], ...patch },
		}))
	}, [])

	function requestRow(rowId: string) {
		if (activeRowId === rowId) {
			setActiveRowId(null)
			setSwitchPrompt(null)
			return
		}
		if (activeRowId && activeRowId !== rowId && hasDraft(drafts[activeRowId])) {
			setSwitchPrompt({ fromId: activeRowId, toId: rowId })
			return
		}
		setSwitchPrompt(null)
		setActiveRowId(rowId)
	}

	function confirmDiscardSwitch() {
		if (!switchPrompt) return
		setDrafts((prev) => {
			const next = { ...prev }
			delete next[switchPrompt.fromId]
			return next
		})
		setActiveRowId(switchPrompt.toId)
		setSwitchPrompt(null)
	}

	const parsedQty = activeDraft ? parseQty(activeDraft.qty) : null

	const gateItems = useMemo(() => {
		const items: {
			id: string
			ok: boolean | "warn"
			label: string
		}[] = []
		if (parsedQty == null) {
			items.push({
				id: "qty",
				ok: false,
				label: t("ds.installer.adjust_gate_qty"),
			})
		} else {
			items.push({
				id: "qty",
				ok: true,
				label: t("ds.installer.adjust_gate_qty_ok"),
			})
		}
		if (!activeDraft?.note.trim()) {
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
	}, [activeDraft?.note, parsedQty, t])

	const canSave = gateItems.every((item) => item.ok === true)

	const greetSubtitle = !parStatus.hasParLevels
		? t("ds.installer.adjust_greet_no_par", { vanName: van.name })
		: parStatus.belowParCount > 0
			? t("ds.installer.adjust_greet_below_par", {
					vanName: van.name,
					count: parStatus.belowParCount,
				})
			: t("ds.installer.adjust_greet_at_par", { vanName: van.name })

	function rowStatus(row: AdjustInventoryRow) {
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
		<DesignSystem constrain>
			<Back to="/installer">← {t("ds.back")}</Back>
			<Greet title={t("installer_adjust.title")} subtitle={greetSubtitle} />

			<ParStatusBanner
				parStatus={parStatus}
				hasPendingRestock={hasPendingRestock}
			/>

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
					<Note tone="neutral">{t("ds.installer.adjust_serial_note")}</Note>

					{switchPrompt ? (
						<Note tone="warn" key="switch-prompt">
							{t("ds.installer.adjust_discard_prompt")}{" "}
							<button
								type="button"
								className="jaf-btn jaf-ghost jaf-sm"
								style={{ minHeight: 44, marginInline: 4 }}
								onClick={confirmDiscardSwitch}
							>
								{t("ds.installer.adjust_discard_confirm")}
							</button>
							<button
								type="button"
								className="jaf-btn jaf-ghost jaf-sm"
								style={{ minHeight: 44 }}
								onClick={() => setSwitchPrompt(null)}
							>
								{t("ds.installer.adjust_discard_cancel")}
							</button>
						</Note>
					) : null}

					<div className="jaf-tblwrap">
						<table>
							<thead>
								<tr>
									<th>{t("ds.installer.adjust_col_material")}</th>
									<th>{t("ds.installer.adjust_col_par")}</th>
									<th>{t("ds.installer.adjust_col_on_hand")}</th>
									<th>{t("ds.installer.adjust_col_status")}</th>
									<th>{t("ds.installer.adjust_col_action")}</th>
								</tr>
							</thead>
							<tbody>
								{comparison.map((row) => {
									const status = rowStatus(row)
									const isActive = activeRowId === row.serviceCodeId
									const qtyId = `adjust-qty-${row.serviceCodeId}`
									const noteId = `adjust-note-${row.serviceCodeId}`
									const rowDraft = drafts[row.serviceCodeId] ?? emptyDraft()
									const rowQty = parseQty(rowDraft.qty)
									const rowAfter = rowQty != null ? row.onHand - rowQty : null

									return (
										<Fragment key={row.serviceCodeId}>
											<tr>
												<td>
													<span className="jaf-mono">{row.claroCode}</span>
													<span className="jaf-sub"> — {row.name}</span>
												</td>
												<td className="jaf-num">
													{parCodeIds.has(row.serviceCodeId)
														? row.standard
														: "—"}
												</td>
												<td className="jaf-num">{row.onHand}</td>
												<td>
													<Tag tone={status.tone}>{status.label}</Tag>
												</td>
												<td className="jaf-act">
													<button
														type="button"
														className="jaf-btn jaf-ghost"
														style={{ minHeight: 44, minWidth: 44 }}
														aria-expanded={isActive}
														aria-label={t("ds.installer.adjust_row_btn", {
															material: row.name,
														})}
														onClick={() => requestRow(row.serviceCodeId)}
													>
														{t("ds.installer.adjust_btn")}
													</button>
												</td>
											</tr>
											{isActive ? (
												<tr>
													<td colSpan={5}>
														<Form
															method="post"
															className="jaf-form2"
															style={{ marginTop: 8 }}
														>
															<input
																type="hidden"
																name="serviceCodeId"
																value={row.serviceCodeId}
															/>
															{rowQty != null ? (
																<input
																	type="hidden"
																	name="qty"
																	value={rowQty}
																/>
															) : null}
															<Field
																label={t("ds.installer.adjust_qty_label")}
																htmlFor={qtyId}
															>
																<input
																	id={qtyId}
																	type="number"
																	min={1}
																	step={1}
																	inputMode="numeric"
																	className="jaf-inp jaf-qty"
																	value={rowDraft.qty}
																	onChange={(e) =>
																		updateDraft(row.serviceCodeId, {
																			qty: e.target.value,
																		})
																	}
																	aria-describedby={`${qtyId}-help ${qtyId}-preview`}
																/>
																<p
																	id={`${qtyId}-help`}
																	className="jaf-sub"
																	style={{ marginTop: 6 }}
																>
																	{t("ds.installer.adjust_qty_helper")}
																</p>
															</Field>
															{rowQty != null ? (
																<p
																	id={`${qtyId}-preview`}
																	className="jaf-sub"
																	style={{ marginTop: 4 }}
																>
																	{t("ds.installer.adjust_qty_preview", {
																		before: row.onHand,
																		after: rowAfter,
																	})}
																</p>
															) : null}
															{rowAfter != null && rowAfter < 0 ? (
																<Note tone="warn">
																	{t("ds.installer.adjust_qty_negative", {
																		after: rowAfter,
																	})}
																</Note>
															) : null}
															<Field
																label={t("installer_adjust.note_label")}
																htmlFor={noteId}
															>
																<textarea
																	id={noteId}
																	name="note"
																	rows={3}
																	required
																	className="jaf-inp"
																	value={rowDraft.note}
																	onChange={(e) =>
																		updateDraft(row.serviceCodeId, {
																			note: e.target.value,
																		})
																	}
																	placeholder={t(
																		"installer_adjust.note_placeholder",
																	)}
																/>
															</Field>
															<Gate items={gateItems} live />
															<div className="jaf-actions">
																<DsButton type="submit" disabled={!canSave}>
																	{t("installer_adjust.submit")}
																</DsButton>
																<button
																	type="button"
																	className="jaf-btn jaf-ghost"
																	style={{ minHeight: 44 }}
																	onClick={() => setActiveRowId(null)}
																>
																	{t("ds.cancel")}
																</button>
															</div>
														</Form>
													</td>
												</tr>
											) : null}
										</Fragment>
									)
								})}
							</tbody>
						</table>
					</div>
				</Box>
			)}
		</DesignSystem>
	)
}

export function ParStatusBanner({
	parStatus,
	hasPendingRestock,
}: {
	parStatus: AdjustParStatus
	hasPendingRestock: boolean
}) {
	const { t } = useTranslation()

	if (!parStatus.hasParLevels) {
		return <Note tone="neutral">{t("ds.installer.adjust_banner_no_par")}</Note>
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
