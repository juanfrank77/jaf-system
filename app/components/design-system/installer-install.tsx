import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, useNavigation } from "react-router"
import { useOnline } from "~/hooks/use-online"
import { queueInstallerInstall } from "~/lib/installer-sync"
import { cn } from "~/lib/utils"
import type { AdjustInventoryRow } from "./installer-adjust"
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

export const INSTALL_SERVICE_TYPES = [
	"CABLE_TV",
	"WIFI",
	"PHONE",
	"OTHER",
] as const

export const INSTALL_WIZARD_STEPS = ["info", "materials", "submit"] as const

export type InstallWizardStep = (typeof INSTALL_WIZARD_STEPS)[number]

type MaterialLine = { _key: string; serviceCodeId: string; qty: number }

type ServiceCode = {
	id: string
	claroCode: string | null
	name: string
}

export function buildInstallItems(
	lines: { serviceCodeId: string; qty: number }[],
) {
	return lines.filter((line) => line.serviceCodeId && line.qty > 0)
}

export function isInstallInfoComplete({
	claroJobReference,
	serviceType,
	date,
}: {
	claroJobReference: string
	serviceType: string
	date: string
}) {
	return (
		claroJobReference.trim().length > 0 &&
		serviceType.trim().length > 0 &&
		date.trim().length > 0
	)
}

export function isInstallMaterialsComplete(
	lines: { serviceCodeId: string; qty: number }[],
) {
	return buildInstallItems(lines).length > 0
}

export function canAdvanceInstallStep({
	step,
	claroJobReference,
	serviceType,
	date,
	lines,
}: {
	step: InstallWizardStep
	claroJobReference: string
	serviceType: string
	date: string
	lines: { serviceCodeId: string; qty: number }[]
}) {
	switch (step) {
		case "info":
			return isInstallInfoComplete({ claroJobReference, serviceType, date })
		case "materials":
			return isInstallMaterialsComplete(lines)
		case "submit":
			return false
		default:
			return false
	}
}

export function buildInstallSubmitMissing({
	claroJobReference,
	serviceType,
	date,
	lines,
}: {
	claroJobReference: string
	serviceType: string
	date: string
	lines: { serviceCodeId: string; qty: number }[]
}) {
	const missing: ("claro" | "serviceType" | "date" | "materials")[] = []
	if (!claroJobReference.trim()) missing.push("claro")
	if (!serviceType.trim()) missing.push("serviceType")
	if (!date.trim()) missing.push("date")
	if (!isInstallMaterialsComplete(lines)) missing.push("materials")
	return missing
}

export function canSubmitInstall(args: {
	claroJobReference: string
	serviceType: string
	date: string
	lines: { serviceCodeId: string; qty: number }[]
}) {
	return buildInstallSubmitMissing(args).length === 0
}

function defaultDateValue() {
	return new Date().toISOString().split("T")[0]
}

export function InstallerInstallV2({
	serviceCodes,
	comparison,
	errorKey,
}: {
	serviceCodes: ServiceCode[]
	comparison: AdjustInventoryRow[]
	errorKey: string | null
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const online = useOnline()
	const [queued, setQueued] = useState(false)
	const submitStartedRef = useRef(false)
	const [submitStarted, setSubmitStarted] = useState(false)
	const navigationSubmitting =
		online &&
		navigation.state !== "idle" &&
		navigation.formMethod != null &&
		navigation.formMethod.toLowerCase() === "post"
	const isSubmitting = submitStarted || navigationSubmitting

	useEffect(() => {
		if (navigation.state === "idle" && errorKey) {
			submitStartedRef.current = false
			setSubmitStarted(false)
		}
	}, [navigation.state, errorKey])

	const [step, setStep] = useState<InstallWizardStep>("info")
	const [claroJobReference, setClaroJobReference] = useState("")
	const [serviceType, setServiceType] = useState("")
	const [date, setDate] = useState(defaultDateValue)
	const [notes, setNotes] = useState("")
	const [lines, setLines] = useState<MaterialLine[]>([
		{ _key: "1", serviceCodeId: "", qty: 1 },
	])

	const onHandByCode = useMemo(
		() => new Map(comparison.map((row) => [row.serviceCodeId, row.onHand])),
		[comparison],
	)

	const items = useMemo(
		() =>
			buildInstallItems(
				lines.map(({ serviceCodeId, qty }) => ({ serviceCodeId, qty })),
			),
		[lines],
	)

	const submitMissing = useMemo(
		() =>
			buildInstallSubmitMissing({
				claroJobReference,
				serviceType,
				date,
				lines,
			}),
		[claroJobReference, serviceType, date, lines],
	)

	const canSubmit = submitMissing.length === 0
	const canAdvance = canAdvanceInstallStep({
		step,
		claroJobReference,
		serviceType,
		date,
		lines,
	})

	const used = new Set(lines.map((line) => line.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter((code) => !used.has(code.id))

	const stepIndex = INSTALL_WIZARD_STEPS.indexOf(step)

	const missingLabels = useMemo(() => {
		const labelKey: Record<
			ReturnType<typeof buildInstallSubmitMissing>[number],
			string
		> = {
			claro: "ds.installer.install_missing_claro",
			serviceType: "ds.installer.install_missing_service_type",
			date: "ds.installer.install_missing_date",
			materials: "ds.installer.install_missing_materials",
		}
		return submitMissing.map((key) => t(labelKey[key] as never))
	}, [submitMissing, t])

	const gateItems = useMemo(() => {
		return [
			{
				id: "info",
				ok: isInstallInfoComplete({ claroJobReference, serviceType, date }),
				label: isInstallInfoComplete({ claroJobReference, serviceType, date })
					? t("ds.installer.gate_info_ok")
					: t("ds.installer.gate_info"),
			},
			{
				id: "materials",
				ok: isInstallMaterialsComplete(lines),
				label: isInstallMaterialsComplete(lines)
					? t("ds.installer.gate_materials_ok")
					: t("ds.installer.gate_materials"),
			},
		]
	}, [claroJobReference, serviceType, date, lines, t])

	function addLine() {
		setLines((prev) => [
			...prev,
			{ _key: String(Date.now()), serviceCodeId: "", qty: 1 },
		])
	}

	function removeLine(key: string) {
		setLines((prev) =>
			prev.length <= 1 ? prev : prev.filter((line) => line._key !== key),
		)
	}

	function updateLine(
		key: string,
		patch: Partial<{ serviceCodeId: string; qty: number }>,
	) {
		setLines((prev) =>
			prev.map((line) => (line._key === key ? { ...line, ...patch } : line)),
		)
	}

	function goBack() {
		if (stepIndex <= 0) return
		setStep(INSTALL_WIZARD_STEPS[stepIndex - 1])
	}

	function goNext() {
		if (!canAdvance || stepIndex >= INSTALL_WIZARD_STEPS.length - 1) return
		setStep(INSTALL_WIZARD_STEPS[stepIndex + 1])
	}

	return (
		<DesignSystem constrain>
			<Back to="/installer">← {t("ds.back")}</Back>
			<Greet
				title={t("installer_install.title")}
				subtitle={t("ds.installer.wizard_rule")}
			/>

			<nav
				className="jaf-tabs"
				aria-label={t("ds.installer.install_steps_label")}
			>
				{INSTALL_WIZARD_STEPS.map((stepId) => (
					<button
						key={stepId}
						type="button"
						className={cn(step === stepId && "jaf-on")}
						aria-current={step === stepId ? "step" : undefined}
						style={{ minHeight: 44 }}
						onClick={() => setStep(stepId)}
					>
						{t(`ds.installer.tab_${stepId}` as never)}
					</button>
				))}
			</nav>

			{errorKey ? <Note tone="crit">{t(errorKey as never)}</Note> : null}
			{queued ? (
				<Note tone="ok">{t("ds.installer.install_offline_saved")}</Note>
			) : null}
			{!online && !queued ? (
				<Note tone="warn">{t("installer_install.offline_submit_notice")}</Note>
			) : null}

			<Form
				method="post"
				className="jaf-grid"
				onSubmit={(e) => {
					if (!online) {
						e.preventDefault()
						if (!canSubmit) return
						queueInstallerInstall({
							claroJobReference: claroJobReference.trim(),
							serviceType,
							date,
							items,
							notes: notes.trim() || null,
						}).then(() => {
							submitStartedRef.current = false
							setSubmitStarted(false)
							setQueued(true)
						})
						return
					}
					if (submitStartedRef.current) {
						e.preventDefault()
						return
					}
					submitStartedRef.current = true
					setSubmitStarted(true)
				}}
			>
				<input type="hidden" name="items" value={JSON.stringify(items)} />

				<div hidden={step !== "info"}>
					<Box span={12}>
						<h2 className="jaf-sub">{t("ds.installer.tab_info")}</h2>
						<div className="jaf-form2">
							<Field
								label={t("installer_install.claro_ref_label")}
								htmlFor="claroJobReference"
							>
								<input
									id="claroJobReference"
									name="claroJobReference"
									required
									className="jaf-inp"
									style={{ minHeight: 44 }}
									value={claroJobReference}
									onChange={(e) => setClaroJobReference(e.target.value)}
									placeholder={t("installer_install.claro_ref_placeholder")}
								/>
							</Field>
							<Field
								label={t("installer_install.service_type_label")}
								htmlFor="serviceType"
							>
								<select
									id="serviceType"
									name="serviceType"
									required
									className="jaf-inp"
									style={{ minHeight: 44 }}
									value={serviceType}
									onChange={(e) => setServiceType(e.target.value)}
								>
									<option value="">
										{t("installer_install.service_type_placeholder")}
									</option>
									{INSTALL_SERVICE_TYPES.map((type) => (
										<option key={type} value={type}>
											{t(
												`installer_install.service_type.${type.toLowerCase()}` as never,
											)}
										</option>
									))}
								</select>
							</Field>
							<Field label={t("installer_install.date_label")} htmlFor="date">
								<input
									id="date"
									name="date"
									type="date"
									required
									className="jaf-inp"
									style={{ minHeight: 44 }}
									value={date}
									onChange={(e) => setDate(e.target.value)}
								/>
							</Field>
						</div>
					</Box>
				</div>

				<div hidden={step !== "materials"}>
					<Box span={12}>
						<h2 className="jaf-sub">
							{t("installer_install.materials_label")}
						</h2>
						<p className="jaf-sub">{t("ds.installer.bracket_unwired")}</p>
						<div className="jaf-tblwrap">
							<table>
								<thead>
									<tr>
										<th>{t("ds.installer.adjust_col_material")}</th>
										<th>{t("ds.installer.adjust_col_on_hand")}</th>
										<th>{t("ds.installer.install_col_qty")}</th>
										<th aria-hidden> </th>
									</tr>
								</thead>
								<tbody>
									{lines.map((line) => {
										const selected = line.serviceCodeId
											? serviceCodes.filter((c) => c.id === line.serviceCodeId)
											: []
										const options = [...selected, ...available]
										const code = serviceCodes.find(
											(c) => c.id === line.serviceCodeId,
										)
										const onHand = line.serviceCodeId
											? (onHandByCode.get(line.serviceCodeId) ?? 0)
											: null
										return (
											<tr key={line._key}>
												<td>
													<select
														className="jaf-inp"
														style={{ minHeight: 44, width: "100%" }}
														value={line.serviceCodeId}
														onChange={(e) =>
															updateLine(line._key, {
																serviceCodeId: e.target.value,
															})
														}
														aria-label={t(
															"installer_install.material_placeholder",
														)}
													>
														<option value="">
															{t("installer_install.material_placeholder")}
														</option>
														{options.map((c) => (
															<option key={c.id} value={c.id}>
																{c.claroCode ? `${c.claroCode} — ` : ""}
																{c.name}
															</option>
														))}
													</select>
													{code && !code.claroCode?.trim() ? (
														<Tag tone="warn">
															{t("ds.installer.install_no_sap_code")}
														</Tag>
													) : null}
												</td>
												<td>{onHand ?? "—"}</td>
												<td>
													<input
														className="jaf-inp jaf-qty"
														type="number"
														min={1}
														inputMode="numeric"
														style={{ minHeight: 44 }}
														value={line.qty}
														onChange={(e) =>
															updateLine(line._key, {
																qty: Number.parseInt(e.target.value, 10) || 1,
															})
														}
														aria-label={t("ds.installer.install_qty_for", {
															material:
																code?.name ?? t("ds.installer.tab_materials"),
														})}
													/>
												</td>
												<td>
													<button
														type="button"
														className="jaf-btn jaf-ghost jaf-sm"
														style={{ minHeight: 44, minWidth: 44 }}
														onClick={() => removeLine(line._key)}
														aria-label={t("ds.installer.install_remove_line")}
													>
														×
													</button>
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
						<div className="jaf-actions" style={{ marginTop: 12 }}>
							<DsButton
								type="button"
								variant="ghost"
								size="sm"
								style={{ minHeight: 44 }}
								onClick={addLine}
							>
								{t("installer_install.add_material")}
							</DsButton>
						</div>
					</Box>
				</div>

				<div hidden={step !== "submit"}>
					<Box span={12}>
						<h2 className="jaf-sub">{t("ds.installer.tab_submit")}</h2>
						<Field label={t("installer_install.notes_label")} htmlFor="notes">
							<textarea
								id="notes"
								name="notes"
								rows={3}
								className="jaf-inp"
								style={{ minHeight: 88 }}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								placeholder={t("installer_install.notes_placeholder")}
							/>
						</Field>
						<Note tone="neutral">
							{t("ds.installer.install_evidence_unavailable")}
						</Note>
						<Gate items={gateItems} live />
						{missingLabels.length > 0 ? (
							<p className="jaf-sub" aria-live="polite">
								{t("ds.installer.install_gate_missing", {
									items: missingLabels.join(", "),
								})}
							</p>
						) : null}
						<div className="jaf-actions" style={{ marginTop: 12 }}>
							<DsButton
								type="submit"
								className="jaf-blue"
								style={{ width: "100%", minHeight: 44 }}
								disabled={!canSubmit || queued || isSubmitting}
							>
								{isSubmitting
									? t("ds.installer.install_sending")
									: online
										? t("installer_install.submit")
										: t("installer_install.save_offline")}
							</DsButton>
						</div>
					</Box>
				</div>

				{step !== "submit" ? (
					<Box span={12}>
						<div className="jaf-actions">
							<DsButton
								type="button"
								variant="ghost"
								style={{ minHeight: 44 }}
								onClick={goBack}
								disabled={stepIndex === 0}
							>
								{t("ds.installer.install_back")}
							</DsButton>
							<DsButton
								type="button"
								className="jaf-blue"
								style={{ minHeight: 44 }}
								onClick={goNext}
								disabled={!canAdvance}
							>
								{t("ds.installer.install_next")}
							</DsButton>
						</div>
					</Box>
				) : (
					<Box span={12}>
						<div className="jaf-actions">
							<DsButton
								type="button"
								variant="ghost"
								style={{ minHeight: 44 }}
								onClick={goBack}
							>
								{t("ds.installer.install_back")}
							</DsButton>
						</div>
					</Box>
				)}
			</Form>
		</DesignSystem>
	)
}
