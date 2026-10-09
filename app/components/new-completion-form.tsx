import type { ParseKeys } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { CompletionStepRail } from "~/components/completion-step-rail"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { QtyStepper } from "~/components/ui/qty-stepper"
import { useOnline } from "~/hooks/use-online"
import { queueCompletion } from "~/lib/installer-completion-sync"
import { COMPLETION_STEPS, type CompletionStep } from "~/lib/installer-steps"
import { pickBracket, prefillAccessories } from "~/lib/limit-table"
import {
	getQueuedActions,
	type QueuedAction,
	removeQueuedAction,
} from "~/lib/offline-store"
import { resolveSerial } from "~/lib/service-codes"
import type { Route } from "../routes/+types/_app.installer.completion.new"

export function NewCompletionForm({
	loaderData,
	actionData,
}: Pick<Route.ComponentProps, "loaderData" | "actionData">) {
	const {
		identity,
		van,
		brackets,
		limitRows,
		serializedCodes,
		accessoryCodes,
		vanSerials,
	} = loaderData
	const { t, i18n } = useTranslation()
	const online = useOnline()
	const sigRef = useRef<SignaturePadHandle>(null)
	const [scanning, setScanning] = useState(false)
	const [serial, setSerial] = useState("")
	const [serialUnreadable, setSerialUnreadable] = useState(false)
	// Shown on step 1 as "(auto)"; set after mount so the server render and
	// the first client render agree.
	const [now, setNow] = useState<Date | null>(null)
	const [scannedAt, setScannedAt] = useState<Date | null>(null)
	const [formPhotoAt, setFormPhotoAt] = useState<Date | null>(null)
	const [formPhotoUrl, setFormPhotoUrl] = useState<string | null>(null)
	useEffect(() => setNow(new Date()), [])
	const timeFmt = (d: Date) =>
		d.toLocaleTimeString(i18n.language, { timeStyle: "short" })
	const [modelResolved, setModelResolved] = useState<string | null>(null)
	const modelName = serializedCodes.find((c) => c.id === modelResolved)?.name
	const [dropFt, setDropFt] = useState<number | "">("")
	const [claroOrderNo, setClaroOrderNo] = useState("")
	const [address, setAddress] = useState("")
	const [idempotencyKey] = useState(() => crypto.randomUUID())
	// Offline completions the server refused on validation: kept, never retried.
	const [rejected, setRejected] = useState<QueuedAction[]>([])
	useEffect(() => {
		getQueuedActions()
			.then((all) =>
				setRejected(
					all.filter((a) => a.action === "INSTALLER_COMPLETION" && a.rejection),
				),
			)
			.catch(() => {})
	}, [])

	const bracket = dropFt === "" ? null : pickBracket(Number(dropFt), brackets)
	// The installer confirms or amends the pre-filled quantities. Edits belong
	// to the bracket they were made in; a new drop footage starts from the
	// table again.
	const [edits, setEdits] = useState<{
		bracket: number | null
		qty: Record<string, number>
	}>({ bracket: null, qty: {} })
	const activeEdits = edits.bracket === bracket ? edits.qty : {}
	const accessories =
		bracket != null
			? prefillAccessories(
					limitRows.map((r) => ({
						bracketFt: r.bracketFt,
						serviceCodeId: r.serviceCodeId,
						qty: r.qty,
					})),
					bracket,
				).map((a) => ({ ...a, qty: activeEdits[a.serviceCodeId] ?? a.qty }))
			: []
	const accessoryCodeById = new Map(accessoryCodes.map((c) => [c.id, c]))
	// The address as it was when the installer first moved past step 1; a later
	// change is shown as a diff and logged on submit.
	const [addressBaseline, setAddressBaseline] = useState<string | null>(null)
	const addressChanged =
		addressBaseline !== null && address.trim() !== addressBaseline
	const [formPhotoName, setFormPhotoName] = useState("")
	// Four gated steps. Every panel stays mounted (hidden) so nothing typed or
	// scanned is lost when going back; Next unlocks only when the step's
	// required capture is done.
	const [stepIndex, setStepIndex] = useState(0)
	const step: CompletionStep = COMPLETION_STEPS[stepIndex]
	const stepComplete = [
		claroOrderNo.trim() !== "" && address.trim() !== "",
		serial !== "" || serialUnreadable,
		dropFt !== "",
		formPhotoName !== "",
	]
	const isLast = stepIndex === COMPLETION_STEPS.length - 1
	const panel = (i: number) => (stepIndex === i ? "space-y-4" : "hidden")

	function handleDecode(text: string) {
		setSerial(text)
		setSerialUnreadable(false)
		const resolved = resolveSerial(text, serializedCodes)
		setModelResolved(resolved ? resolved.id : null)
		setScannedAt(new Date())
		setScanning(false)
	}

	return (
		<div className="space-y-6 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("installer.completion.new_heading", "New Completion")}
			</h1>
			<CompletionStepRail current={step} />
			<Callout
				title={t("installer.installer_flow.completion_step.title", {
					n: stepIndex + 1,
					total: COMPLETION_STEPS.length,
				})}
			>
				{t(`installer.installer_flow.completion_step.${step}`)}
			</Callout>

			{rejected.length > 0 && (
				<Callout tone="danger" title={t("installer.completion.rejected_title")}>
					<ul className="space-y-2">
						{rejected.map((r) => (
							<li key={r.id} className="flex items-start justify-between gap-2">
								<span>
									<span className="font-mono">
										{String(r.payload.claroOrderNo ?? "")}
									</span>{" "}
									{r.rejection?.errorKey
										? t(r.rejection.errorKey as ParseKeys)
										: r.rejection?.message}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={async () => {
										await removeQueuedAction(r.id).catch(() => {})
										setRejected((all) => all.filter((x) => x.id !== r.id))
									}}
								>
									{t("installer.completion.rejected_discard")}
								</Button>
							</li>
						))}
					</ul>
					{t("installer.completion.rejected_hint")}
				</Callout>
			)}

			{actionData && (
				<Callout tone="danger" title={t("installer.completion.errors.title")}>
					{"errorKey" in actionData && actionData.errorKey
						? t(actionData.errorKey)
						: "errorMessage" in actionData
							? actionData.errorMessage
							: null}
				</Callout>
			)}

			<form
				method="post"
				encType="multipart/form-data"
				onSubmit={(e) => {
					if (sigRef.current && !sigRef.current.isEmpty()) {
						const field = document.querySelector<HTMLInputElement>(
							'input[name="sigInstaller"]',
						)
						if (field) field.value = sigRef.current.toDataURL()
					}
					if (!online) {
						e.preventDefault()
						const form = e.currentTarget
						const formPhotoFile = (
							form.elements.namedItem("formPhoto") as HTMLInputElement | null
						)?.files?.[0]
						const buildPayload = (formPhotoBase64?: string) => ({
							idempotencyKey,
							claroOrderNo,
							address,
							addressOriginal: addressBaseline ?? "",
							dropFt: dropFt === "" ? "" : String(dropFt),
							accessories: JSON.stringify(accessories),
							serialInstalled: serialUnreadable ? "" : serial,
							serialUnreadable: String(serialUnreadable),
							modelResolved: modelResolved ?? "",
							groundRod: String(
								(
									form.elements.namedItem(
										"groundRod",
									) as HTMLInputElement | null
								)?.checked ?? true,
							),
							sigInstaller: sigRef.current?.isEmpty()
								? ""
								: (sigRef.current?.toDataURL() ?? ""),
							...(formPhotoBase64
								? {
										formPhotoBase64,
										formPhotoName: formPhotoFile?.name ?? "photo.jpg",
										formPhotoType: formPhotoFile?.type ?? "image/jpeg",
									}
								: {}),
						})
						const queueAndLeave = (formPhotoBase64?: string) =>
							queueCompletion(buildPayload(formPhotoBase64)).then(() => {
								window.location.href = "/installer"
							})
						if (formPhotoFile) {
							const reader = new FileReader()
							reader.onload = () => queueAndLeave(reader.result as string)
							reader.readAsDataURL(formPhotoFile)
						} else {
							queueAndLeave()
						}
					}
				}}
				className="space-y-4"
			>
				<input type="hidden" name="idempotencyKey" value={idempotencyKey} />
				<input
					type="hidden"
					name="accessories"
					value={JSON.stringify(accessories)}
				/>
				<input
					type="hidden"
					name="limitRows"
					value={JSON.stringify(limitRows)}
				/>
				<input
					type="hidden"
					name="brackets"
					value={JSON.stringify(brackets)}
				/>
				<input
					type="hidden"
					name="serialInstalled"
					value={serialUnreadable ? "" : serial}
				/>
				<input
					type="hidden"
					name="serialUnreadable"
					value={String(serialUnreadable)}
				/>
				<input type="hidden" name="modelResolved" value={modelResolved ?? ""} />
				<input type="hidden" name="sigInstaller" value="" />
				<input
					type="hidden"
					name="addressOriginal"
					value={addressBaseline ?? ""}
				/>

				<div className={panel(0)}>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm">
						<dt className="text-muted-foreground">
							{t("installer.completion.installer_label")}
						</dt>
						<dd className="min-w-0 break-words font-medium">
							{[
								identity.name,
								identity.jafNumber
									? t("installer.home.jaf_number", { n: identity.jafNumber })
									: null,
								identity.login,
							]
								.filter(Boolean)
								.join(" · ")}
						</dd>
						<dt className="text-muted-foreground">
							{t("installer.completion.date_label")}
						</dt>
						<dd className="font-medium">
							{now
								? `${now.toLocaleDateString(i18n.language, { dateStyle: "medium" })} · ${timeFmt(now)} ${t("installer.completion.auto")}`
								: "—"}
						</dd>
					</dl>

					<div className="space-y-1">
						<Label htmlFor="claroOrderNo">
							{t("installer.completion.order_no", "Order #")}
						</Label>
						<Input
							id="claroOrderNo"
							name="claroOrderNo"
							className="h-12 text-base"
							inputMode="numeric"
							required
							value={claroOrderNo}
							onChange={(e) => setClaroOrderNo(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="address">
							{t("installer.completion.address", "Address")}
						</Label>
						<Input
							id="address"
							name="address"
							className="h-12 text-base"
							required
							value={address}
							onChange={(e) => setAddress(e.target.value)}
						/>
					</div>

					{addressChanged && (
						<div
							data-testid="address-diff"
							className="rounded-lg bg-status-info-soft p-2.5 text-sm"
						>
							<p className="break-words">
								<span className="text-muted-foreground line-through">
									{addressBaseline}
								</span>
								{" → "}
								<b>{address.trim()}</b>
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{t("installer.completion.address_diff_hint")}
							</p>
						</div>
					)}
				</div>

				<div className={panel(1)}>
					<div className="space-y-2">
						<Label>
							{t("installer.completion.scan_heading", "Scan modem")}
						</Label>
						{scanning ? (
							<BarcodeScanner
								onDecode={handleDecode}
								onGiveUp={() => {
									setSerialUnreadable(true)
									setScanning(false)
								}}
							/>
						) : (
							<button
								type="button"
								data-testid="scan-box"
								onClick={() => setScanning(true)}
								className="flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 p-4 text-center active:bg-muted"
							>
								<span aria-hidden className="text-4xl">
									📷
								</span>
								<span className="text-base font-semibold">
									{serial || serialUnreadable
										? t("installer.completion.scan_again")
										: t("installer.completion.scan_prompt")}
								</span>
								<span className="text-sm text-muted-foreground">
									{t("installer.completion.scan_hint")}
								</span>
							</button>
						)}
					</div>

					{!scanning && serial !== "" && !serialUnreadable && (
						<dl className="space-y-1 rounded-lg bg-muted p-3">
							<dt className="text-xs text-muted-foreground">
								{t("installer.completion.serial_label")}
							</dt>
							<dd
								data-testid="scanned-serial"
								className="break-all font-mono text-2xl font-semibold"
							>
								{serial}
							</dd>
							<dt className="pt-1 text-xs text-muted-foreground">
								{t("installer.completion.model_label")}
							</dt>
							<dd className="text-base font-medium">
								{modelName ?? t("installer.completion.model_unresolved")}
							</dd>
							{scannedAt && (
								<dd className="pt-1 text-sm text-status-ok">
									✓{" "}
									{t("installer.completion.scan_captured", {
										time: timeFmt(scannedAt),
									})}
								</dd>
							)}
						</dl>
					)}

					{!scanning && serialUnreadable && (
						<p className="rounded-lg bg-status-warn-soft p-3 text-sm font-medium text-status-warn">
							{t(
								"installer.completion.serial_unreadable",
								"Unreadable — photo only",
							)}
						</p>
					)}

					{serial !== "" &&
						!serialUnreadable &&
						!vanSerials.includes(serial) && (
							<Callout
								tone="warn"
								title={t("installer.completion.serial_not_on_van_title", {
									van: van?.name ?? "",
								})}
							>
								{t("installer.completion.serial_not_on_van_body")}
							</Callout>
						)}

					{serial !== "" && !serialUnreadable && !modelResolved && (
						<Callout
							tone="warn"
							title={t("installer.completion.model_unknown_title")}
						>
							{t("installer.completion.model_unknown_body")}
						</Callout>
					)}
				</div>

				<div className={panel(2)}>
					<div className="space-y-1">
						<Label htmlFor="dropFt">
							{t("installer.completion.drop_ft", "Drop (ft)")}
						</Label>
						<Input
							id="dropFt"
							name="dropFt"
							type="number"
							inputMode="numeric"
							className="h-12 text-base"
							min={0}
							value={dropFt}
							onChange={(e) =>
								setDropFt(e.target.value === "" ? "" : Number(e.target.value))
							}
						/>
					</div>

					<label
						htmlFor="groundRod"
						className="flex min-h-11 items-center gap-3 text-base"
					>
						<Checkbox
							id="groundRod"
							name="groundRod"
							defaultChecked
							value="true"
							className="size-6"
						/>
						{t("installer.completion.ground_rod", "Ground rod installed")}
					</label>

					{bracket != null && (
						<div className="space-y-2">
							<p className="rounded-lg bg-muted p-3 text-sm">
								{t("installer.completion.accessories_summary", {
									count: accessories.length,
									units: accessories.reduce((n, a) => n + a.qty, 0),
									bracket,
								})}
							</p>
							<ul>
								{accessories.map((a) => {
									const code = accessoryCodeById.get(a.serviceCodeId)
									const name = code?.name ?? a.serviceCodeId
									const edited = a.qty !== a.prefilledQty
									return (
										<li
											key={a.serviceCodeId}
											className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
										>
											<div className="min-w-0">
												<p className="text-sm font-medium leading-snug">
													{name}
												</p>
												{code && (
													<p className="font-mono text-xs text-muted-foreground">
														{code.claroCode}
													</p>
												)}
												<p className="text-xs text-muted-foreground">
													{t("installer.completion.accessory_prefilled", {
														qty: a.prefilledQty,
													})}
													{edited && (
														<span className="ml-2 rounded bg-status-warn-soft px-1.5 py-0.5 font-medium text-status-warn">
															{t("installer.completion.accessory_edited")}
														</span>
													)}
												</p>
											</div>
											<QtyStepper
												value={a.qty}
												onChange={(qty) =>
													setEdits({
														bracket,
														qty: { ...activeEdits, [a.serviceCodeId]: qty },
													})
												}
												label={name}
												invalid={edited}
											/>
										</li>
									)
								})}
							</ul>
							<p className="text-xs text-muted-foreground">
								{t("installer.completion.accessories_hint")}
							</p>
						</div>
					)}
				</div>

				<div className={panel(3)}>
					<div className="space-y-2">
						<Label htmlFor="formPhoto">
							{t("installer.completion.form_photo", "Claro form photo")}{" "}
							<span className="text-status-danger">
								{t("installer.completion.required")}
							</span>
						</Label>
						<label
							htmlFor="formPhoto"
							data-testid="form-photo-box"
							className="flex min-h-48 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/40 p-4 text-center active:bg-muted"
						>
							{formPhotoUrl ? (
								<img
									src={formPhotoUrl}
									alt={t("installer.completion.form_photo_alt")}
									className="max-h-56 rounded-lg object-contain"
								/>
							) : (
								<>
									<span aria-hidden className="text-4xl">
										📷
									</span>
									<span className="text-base font-semibold">
										{t("installer.completion.form_photo_prompt")}
									</span>
									<span className="text-sm text-muted-foreground">
										{t("installer.completion.form_photo_hint")}
									</span>
								</>
							)}
						</label>
						<input
							id="formPhoto"
							name="formPhoto"
							type="file"
							accept="image/*"
							capture="environment"
							className="sr-only"
							required
							onChange={(e) => {
								const file = e.target.files?.[0]
								setFormPhotoName(file?.name ?? "")
								setFormPhotoAt(file ? new Date() : null)
								setFormPhotoUrl((old) => {
									if (old) URL.revokeObjectURL(old)
									return file ? URL.createObjectURL(file) : null
								})
							}}
						/>
						{formPhotoAt && (
							<p className="text-sm text-status-ok">
								✓{" "}
								{t("installer.completion.form_photo_saved", {
									time: timeFmt(formPhotoAt),
								})}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label>
							{t("installer.completion.signature", "Installer signature")}
						</Label>
						<SignaturePad ref={sigRef} height={180} />
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-11 text-base"
							onClick={() => sigRef.current?.clear()}
						>
							{t("installer.completion.clear_signature")}
						</Button>
					</div>
				</div>

				<div className={isLast ? "flex flex-col-reverse gap-2" : "flex gap-2"}>
					{stepIndex > 0 && (
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-12 flex-1 text-base"
							onClick={() => setStepIndex(stepIndex - 1)}
						>
							{t("installer.completion.back", "Back")}
						</Button>
					)}
					{isLast ? (
						<Button
							key="submit"
							type="submit"
							size="lg"
							className="h-12 w-full text-base"
							disabled={!stepComplete[stepIndex]}
						>
							{t("installer.completion.submit", "Submit")}
						</Button>
					) : (
						<Button
							key="next"
							type="button"
							size="lg"
							className="h-12 flex-[2] text-base"
							disabled={!stepComplete[stepIndex]}
							onClick={() => {
								if (stepIndex === 0 && addressBaseline === null)
									setAddressBaseline(address.trim())
								setStepIndex(stepIndex + 1)
							}}
						>
							{t(`installer.completion.next_to.${step}`)}
						</Button>
					)}
				</div>
			</form>

			{!van && (
				<p className="text-sm text-status-warn">{t("installer.no_van")}</p>
			)}
		</div>
	)
}
