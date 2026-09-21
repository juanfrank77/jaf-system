import { type FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import {
	Box,
	DesignSystem,
	DsButton,
	Field,
	Gate,
	Greet,
	Note,
	SegmentedControl,
	Tag,
} from "./primitives"

const SERVICE_TYPES = ["CABLE_TV", "WIFI", "PHONE", "OTHER"] as const

const FOOTAGE_STUB = [
	{ ft: 250, hint: "drop ≤ 250 FT" },
	{ ft: 500, hint: "drop ≤ 500 FT" },
	{ ft: 750, hint: "drop ≤ 750 FT" },
] as const

type Line = { _key: string; serviceCodeId: string; qty: number }
type Code = { id: string; claroCode: string; name: string }

export function InstallerWizardV2({
	serviceCodes,
	errorKey,
	online,
	queued,
	lines,
	addLine,
	removeLine,
	updateLine,
	onOfflineSubmit,
}: {
	serviceCodes: Code[]
	errorKey: string | null
	online: boolean
	queued: boolean
	lines: Line[]
	addLine: () => void
	removeLine: (key: string) => void
	updateLine: (key: string, patch: Partial<Omit<Line, "_key">>) => void
	onOfflineSubmit: (e: FormEvent<HTMLFormElement>) => void
}) {
	const { t } = useTranslation()
	const [tab, setTab] = useState("info")
	const [serial, setSerial] = useState("")
	const used = new Set(lines.map((l) => l.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter((c) => !used.has(c.id))

	const gate = [
		{
			id: "info",
			ok: true,
			label: t("ds.installer.gate_info"),
			detail: t("ds.installer.gate_info_detail"),
		},
		{
			id: "serial",
			ok: serial.trim().length > 0 ? true : ("warn" as const),
			label: t("ds.installer.gate_serial"),
			detail: t("ds.installer.serial_unwired"),
		},
		{
			id: "materials",
			ok: lines.some((l) => l.serviceCodeId && l.qty > 0),
			label: t("ds.installer.gate_materials"),
		},
	]

	return (
		<DesignSystem constrain>
			<Link to="/installer" className="jaf-back">
				← {t("ds.back")}
			</Link>
			<Greet
				title={t("installer_install.title")}
				subtitle={t("ds.installer.wizard_rule")}
			/>
			<SegmentedControl
				tabs={[
					{ id: "info", label: t("ds.installer.tab_info") },
					{ id: "device", label: t("ds.installer.tab_device") },
					{ id: "materials", label: t("ds.installer.tab_materials") },
					{ id: "submit", label: t("ds.installer.tab_submit") },
				]}
				active={tab}
				onSelect={setTab}
			/>

			{errorKey ? <Note tone="crit">{t(errorKey as never)}</Note> : null}
			{queued ? (
				<Note tone="ok">{t("installer_install.queued_message")}</Note>
			) : null}
			{!online && !queued ? (
				<Note>{t("installer_install.offline_submit_notice")}</Note>
			) : null}

			<Form
				method="post"
				onSubmit={(e) => {
					if (!online) onOfflineSubmit(e)
				}}
			>
				<input
					type="hidden"
					name="items"
					value={JSON.stringify(
						lines.map(({ serviceCodeId, qty }) => ({ serviceCodeId, qty })),
					)}
				/>

				<div hidden={tab !== "info"}>
					<Box span={12}>
						<h2>{t("ds.installer.tab_info")}</h2>
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
								>
									<option value="">
										{t("installer_install.service_type_placeholder")}
									</option>
									{SERVICE_TYPES.map((type) => (
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
									defaultValue={new Date().toISOString().split("T")[0]}
								/>
							</Field>
							<Field
								label={t("ds.installer.drop_footage")}
								htmlFor="dropFootage"
							>
								<input
									id="dropFootage"
									type="number"
									min={0}
									className="jaf-inp"
									placeholder="250"
								/>
							</Field>
						</div>
						<p className="jaf-sub" style={{ marginTop: 14 }}>
							{t("ds.installer.bracket_unwired")}
						</p>
						<table>
							<thead>
								<tr>
									<th>{t("ds.installer.col_bracket")}</th>
									<th>{t("ds.installer.col_hint")}</th>
									<th>{t("ds.installer.col_status")}</th>
								</tr>
							</thead>
							<tbody>
								{FOOTAGE_STUB.map((row) => (
									<tr key={row.ft}>
										<td className="jaf-mono">{row.ft} FT</td>
										<td>{row.hint}</td>
										<td>
											<Tag tone="warn">{t("ds.not_wired")}</Tag>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</Box>
				</div>

				<div hidden={tab !== "device"}>
					<Box span={12}>
						<h2>{t("ds.installer.tab_device")}</h2>
						<p className="jaf-sub">{t("ds.installer.serial_unwired")}</p>
						<div className="jaf-scan">
							<Field label={t("ds.installer.serial_label")} htmlFor="serial">
								<input
									id="serial"
									className="jaf-inp"
									value={serial}
									onChange={(e) => setSerial(e.target.value)}
									placeholder={t("ds.installer.serial_placeholder")}
								/>
							</Field>
						</div>
					</Box>
				</div>

				<div hidden={tab !== "materials"}>
					<Box span={12}>
						<h2>{t("installer_install.materials_label")}</h2>
						{lines.map((line) => {
							const selected = line.serviceCodeId
								? serviceCodes.filter((c) => c.id === line.serviceCodeId)
								: []
							const options = [...selected, ...available]
							return (
								<div
									key={line._key}
									className="jaf-actions"
									style={{ marginTop: 8 }}
								>
									<select
										className="jaf-inp"
										value={line.serviceCodeId}
										onChange={(e) =>
											updateLine(line._key, { serviceCodeId: e.target.value })
										}
									>
										<option value="">
											{t("installer_install.material_placeholder")}
										</option>
										{options.map((c) => (
											<option key={c.id} value={c.id}>
												{c.claroCode} — {c.name}
											</option>
										))}
									</select>
									<input
										className="jaf-inp jaf-qty"
										type="number"
										min={1}
										value={line.qty}
										onChange={(e) =>
											updateLine(line._key, {
												qty: Number.parseInt(e.target.value, 10) || 1,
											})
										}
									/>
									<button
										type="button"
										className="jaf-btn jaf-ghost jaf-sm"
										onClick={() => removeLine(line._key)}
									>
										×
									</button>
								</div>
							)
						})}
						<div className="jaf-actions">
							<DsButton
								type="button"
								variant="ghost"
								size="sm"
								onClick={addLine}
							>
								{t("installer_install.add_material")}
							</DsButton>
						</div>
					</Box>
				</div>

				<div hidden={tab !== "submit"}>
					<Box span={12}>
						<h2>{t("ds.installer.tab_submit")}</h2>
						<Field label={t("installer_install.notes_label")} htmlFor="notes">
							<textarea
								id="notes"
								name="notes"
								rows={3}
								className="jaf-inp"
								placeholder={t("installer_install.notes_placeholder")}
							/>
						</Field>
						<Gate items={gate} />
						<div className="jaf-actions">
							<DsButton type="submit">
								{online
									? t("installer_install.submit")
									: t("installer_install.save_offline")}
							</DsButton>
						</div>
					</Box>
				</div>
			</Form>
		</DesignSystem>
	)
}
