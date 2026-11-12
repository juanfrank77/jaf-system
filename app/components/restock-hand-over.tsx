import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { CrewSignerSelect } from "~/components/crew-signer-select"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"

type Line = {
	id: string
	brigade: string
	material: string
	unit: string | null
	qty: number
}
type SignerGroup = {
	brigadeId: string
	brigadeName: string
	brigadeCode: string | null
	signers: { key: string; name: string }[]
}

/**
 * The hand over of a brigade restock: Orlando sets what was actually GIVEN per
 * line (a note is required when it is less than asked), then the brigade's
 * crew signs with the warehouse, on the same pads and signer lists as the
 * material release for a dispatch job. The supervisor signs nothing.
 */
export function RestockHandOver({
	id,
	lines,
	warehouseUsers,
	signerGroups,
}: {
	id: string
	lines: Line[]
	warehouseUsers: { id: string; name: string }[]
	signerGroups: SignerGroup[]
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ errorKey?: string }>()
	const releaseRef = useRef<SignaturePadHandle>(null)
	const crewRef = useRef<SignaturePadHandle>(null)
	// Kept as typed so a half-edited box never posts a surprise number.
	const [given, setGiven] = useState<Record<string, string>>(
		Object.fromEntries(lines.map((l) => [l.id, String(l.qty)])),
	)
	const [notes, setNotes] = useState<Record<string, string>>({})
	const [releasedById, setReleasedById] = useState(
		warehouseUsers.length === 1 ? warehouseUsers[0].id : "",
	)
	const [crewSigner, setCrewSigner] = useState(
		signerGroups.length === 1 && signerGroups[0].signers.length === 1
			? signerGroups[0].signers[0].key
			: "",
	)
	const [releaseSigned, setReleaseSigned] = useState(false)
	const [crewSigned, setCrewSigned] = useState(false)
	const [clientError, setClientError] = useState<string | null>(null)
	const busy = fetcher.state !== "idle"

	const givenOf = (l: Line) => Number(given[l.id])
	const isShort = (l: Line) => givenOf(l) < l.qty

	const submit = () => {
		const bad = lines.find(
			(l) =>
				!Number.isInteger(givenOf(l)) || givenOf(l) < 0 || givenOf(l) > l.qty,
		)
		if (bad) return setClientError("brigade_stock.errors.bad_given")
		if (lines.some((l) => isShort(l) && !notes[l.id]?.trim()))
			return setClientError("brigade_stock.errors.short_needs_note")
		if (!releasedById)
			return setClientError("docs_sign.alerts.release_signer_required")
		if (!crewSigner)
			return setClientError("docs_sign.alerts.crew_signer_required")
		if (releaseRef.current?.isEmpty())
			return setClientError("docs_sign.alerts.release_signature_required")
		if (crewRef.current?.isEmpty())
			return setClientError("docs_sign.alerts.crew_signature_required")
		setClientError(null)
		const fd = new FormData()
		fd.set("intent", "hand_over")
		fd.set("id", id)
		fd.set("releasedById", releasedById)
		fd.set("crewSigner", crewSigner)
		fd.set("releaseSignature", releaseRef.current?.toDataURL() ?? "")
		fd.set("crewSignature", crewRef.current?.toDataURL() ?? "")
		fd.set(
			"lines",
			JSON.stringify(
				lines.map((l) => ({
					lineId: l.id,
					givenQty: givenOf(l),
					note: notes[l.id] ?? "",
				})),
			),
		)
		fetcher.submit(fd, { method: "post" })
	}

	const errorKey = clientError ?? fetcher.data?.errorKey ?? null

	return (
		<div
			className="space-y-4 rounded-lg border bg-muted/20 p-3"
			data-testid="restock-hand-over"
		>
			<ul className="space-y-2">
				{lines.map((l) => (
					<li key={l.id} className="space-y-1 text-sm">
						<p>
							{l.brigade} · {l.material}
							<span className="text-muted-foreground">
								{" "}
								· {t("brigade_stock.wh_asked", { qty: l.qty })} {l.unit ?? ""}
							</span>
						</p>
						<div className="flex flex-wrap items-center gap-2">
							<Label
								htmlFor={`given-${l.id}`}
								className="text-xs text-muted-foreground"
							>
								{t("brigade_stock.wh_given")}
							</Label>
							<Input
								id={`given-${l.id}`}
								type="number"
								inputMode="numeric"
								min={0}
								max={l.qty}
								step={1}
								className="w-24"
								value={given[l.id]}
								onChange={(e) => setGiven({ ...given, [l.id]: e.target.value })}
							/>
							<span className="text-xs text-muted-foreground">
								{t("brigade_stock.wh_of", { qty: l.qty })}
							</span>
							{given[l.id] !== "" && isShort(l) && (
								<Input
									aria-label={t("brigade_stock.wh_note")}
									placeholder={t("brigade_stock.wh_note")}
									className="min-w-48 flex-1"
									value={notes[l.id] ?? ""}
									onChange={(e) =>
										setNotes({ ...notes, [l.id]: e.target.value })
									}
								/>
							)}
						</div>
					</li>
				))}
			</ul>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-3 rounded-lg border p-3">
					<div>
						<p className="mb-1 text-sm font-medium">
							{t("docs_sign.release_signature_heading")}
						</p>
						<Label className="text-xs text-muted-foreground">
							{t("docs_sign.release_signer_label")}
						</Label>
						<Select
							items={warehouseUsers.map((u) => ({
								value: u.id,
								label: u.name,
							}))}
							value={releasedById}
							onValueChange={(v) => setReleasedById(v ?? "")}
						>
							<SelectTrigger className="mt-1 h-11 w-full text-base">
								<SelectValue
									placeholder={t("docs_sign.release_signer_placeholder")}
								/>
							</SelectTrigger>
							<SelectContent>
								{warehouseUsers.map((u) => (
									<SelectItem key={u.id} value={u.id}>
										{u.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<SignaturePad
						ref={releaseRef}
						height={140}
						onChange={(empty) => setReleaseSigned(!empty)}
					/>
					<p className="text-xs text-muted-foreground">
						{releaseSigned ? t("docs_sign.signed") : t("docs_sign.sig_prompt")}
					</p>
					<Button
						type="button"
						variant="ghost"
						onClick={() => releaseRef.current?.clear()}
					>
						{t("docs_sign.clear")}
					</Button>
				</div>

				<div className="space-y-3 rounded-lg border p-3">
					<div>
						<p className="mb-1 text-sm font-medium">
							{t("docs_sign.crew_signature_heading")}
						</p>
						<Label className="text-xs text-muted-foreground">
							{t("docs_sign.crew_signer_label")}
						</Label>
						<CrewSignerSelect
							groups={signerGroups}
							value={crewSigner}
							onChange={setCrewSigner}
						/>
					</div>
					<SignaturePad
						ref={crewRef}
						height={140}
						onChange={(empty) => setCrewSigned(!empty)}
					/>
					<p className="text-xs text-muted-foreground">
						{crewSigned ? t("docs_sign.signed") : t("docs_sign.sig_prompt")}
					</p>
					<Button
						type="button"
						variant="ghost"
						onClick={() => crewRef.current?.clear()}
					>
						{t("docs_sign.clear")}
					</Button>
				</div>
			</div>

			{errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(errorKey as never, errorKey)}
				</p>
			)}
			<Button type="button" disabled={busy} onClick={submit}>
				{t("brigade_stock.wh_sign_close")}
			</Button>
		</div>
	)
}
