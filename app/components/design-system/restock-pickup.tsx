import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import {
	Back,
	Box,
	DesignSystem,
	DsButton,
	Gate,
	Greet,
	Note,
	Tag,
} from "./primitives"

export type PickupLine = {
	serviceCodeId: string
	claroCode: string
	name: string
	approvedQty: number
}

export function canConfirmPickup({
	installerSigned,
	submitted,
}: {
	installerSigned: boolean
	submitted: boolean
}) {
	return installerSigned && !submitted
}

function DsSignatureSlot({
	label,
	clearLabel,
	padRef,
	onSignedChange,
	disabled,
}: {
	label: string
	clearLabel: string
	padRef: React.RefObject<SignaturePadHandle | null>
	onSignedChange: (signed: boolean) => void
	disabled?: boolean
}) {
	return (
		<div className="jaf-sig">
			<div className="jaf-lbl">{label}</div>
			<div
				style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}
			>
				<SignaturePad
					ref={padRef}
					width={320}
					height={120}
					ariaLabel={label}
					onEnd={() => onSignedChange(padRef.current?.isEmpty() === false)}
				/>
			</div>
			<DsButton
				type="button"
				variant="ghost"
				size="sm"
				style={{ minHeight: 44, marginTop: 8 }}
				disabled={disabled}
				onClick={() => {
					padRef.current?.clear()
					onSignedChange(false)
				}}
			>
				{clearLabel}
			</DsButton>
		</div>
	)
}

export function RestockPickupV2({
	requestId,
	warehouseName,
	lines,
	errorKey,
}: {
	requestId: string
	warehouseName: string
	lines: PickupLine[]
	errorKey: string | null
}) {
	const { t } = useTranslation()
	const installerRef = useRef<SignaturePadHandle>(null)
	const [installerSigned, setInstallerSigned] = useState(false)
	const [submitted, setSubmitted] = useState(false)
	const canConfirm = canConfirmPickup({ installerSigned, submitted })

	const gateItems = useMemo(() => {
		return [
			{
				id: "installer",
				ok: installerSigned,
				label: installerSigned
					? t("ds.installer.pickup_gate_installer_ok")
					: t("ds.installer.pickup_gate_installer"),
			},
		]
	}, [installerSigned, t])

	const pickupSummary = lines
		.map((line) => `${line.claroCode} × ${line.approvedQty}`)
		.join(" · ")

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		if (!canConfirm) return
		const signature = installerRef.current?.toDataURL()
		if (!signature || signature === "data:,") return
		setSubmitted(true)
		const formData = new FormData(e.currentTarget)
		formData.set("signature", signature)
		const form = e.currentTarget
		for (const [key, value] of formData.entries()) {
			const input = form.querySelector(
				`[name="${key}"]`,
			) as HTMLInputElement | null
			if (input && input.value !== value) input.value = value as string
		}
		form.submit()
	}

	return (
		<DesignSystem constrain>
			<Back to="/installer">← {t("ds.back")}</Back>
			<Greet
				title={t("restock_pickup.title", { id: requestId.slice(-6) })}
				subtitle={warehouseName}
			/>

			{errorKey ? <Note tone="crit">{t(errorKey as never)}</Note> : null}

			{submitted ? (
				<Note tone="ok">
					{t("ds.installer.pickup_confirmed_note", { summary: pickupSummary })}
				</Note>
			) : null}

			<Box span={12}>
				<div className="jaf-tblwrap">
					<table>
						<thead>
							<tr>
								<th>{t("ds.installer.restock_col_material")}</th>
								<th>{t("ds.installer.pickup_col_approved")}</th>
								<th>{t("ds.installer.pickup_col_taking")}</th>
							</tr>
						</thead>
						<tbody>
							{lines.map((line) => (
								<tr key={line.serviceCodeId}>
									<td>
										<div>{line.name}</div>
										<div className="jaf-sub">{line.claroCode}</div>
									</td>
									<td>{line.approvedQty}</td>
									<td>
										{line.approvedQty}{" "}
										<Tag tone="default">
											{t("ds.installer.pickup_read_only")}
										</Tag>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<Note tone="neutral">{t("ds.installer.pickup_read_only_note")}</Note>
			</Box>

			<Box span={12}>
				<DsSignatureSlot
					label={t("ds.installer.pickup_sig_installer")}
					clearLabel={t("restock_pickup.clear")}
					padRef={installerRef}
					onSignedChange={setInstallerSigned}
					disabled={submitted}
				/>
			</Box>

			<Box span={12}>
				<Gate items={gateItems} live />
				<Form method="post" onSubmit={handleSubmit}>
					<input type="hidden" name="signature" value="" />
					<DsButton
						type="submit"
						className="jaf-blue"
						style={{ width: "100%", minHeight: 44, marginTop: 12 }}
						disabled={!canConfirm}
					>
						{t("restock_pickup.submit")}
					</DsButton>
				</Form>
			</Box>
		</DesignSystem>
	)
}
