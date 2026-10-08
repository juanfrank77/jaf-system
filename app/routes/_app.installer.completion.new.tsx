import fs from "node:fs/promises"
import path from "node:path"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, redirect } from "react-router"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { CompletionStepRail } from "~/components/completion-step-rail"
import { RouteErrorBoundary } from "~/components/error-boundary"
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
import { submitCompletion } from "~/lib/completion-submit.server"
import { db } from "~/lib/db.server"
import {
	buildAddressCorrection,
	mergeAddressCorrections,
} from "~/lib/field-update-helpers"
import { validateFile } from "~/lib/file-upload.server"
import { queueCompletion } from "~/lib/installer-completion-sync"
import { requireInstaller } from "~/lib/installer-context.server"
import { COMPLETION_STEPS, type CompletionStep } from "~/lib/installer-steps"
import { pickBracket, prefillAccessories } from "~/lib/limit-table"
import { resolveSerial } from "~/lib/service-codes"
import { getSerializedCodes } from "~/lib/service-codes.server"
import type { Route } from "./+types/_app.installer.completion.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Completion — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user, van } = await requireInstaller(request)
	const [limitRows, serializedCodes] = await Promise.all([
		db.limitTable.findMany(),
		getSerializedCodes(),
	])
	const brackets = [...new Set(limitRows.map((r) => r.bracketFt))].sort(
		(a, b) => a - b,
	)
	// Names for the accessory lines, and the serials this van is carrying so
	// the scan step can warn (not block) when a scanned serial is not on it.
	const [accessoryCodes, vanSerialRows] = await Promise.all([
		db.serviceCode.findMany({
			where: {
				id: { in: [...new Set(limitRows.map((r) => r.serviceCodeId))] },
			},
			select: { id: true, claroCode: true, name: true, unit: true },
		}),
		van
			? db.serialLocation.findMany({
					where: { status: "VAN", currentRef: van.id },
					select: { serial: true },
				})
			: Promise.resolve([]),
	])
	return {
		user,
		van,
		brackets,
		limitRows,
		serializedCodes,
		accessoryCodes,
		vanSerials: vanSerialRows.map((r) => r.serial),
	}
}

async function resolveAccessories(
	raw: string,
	dropFt: number | undefined,
): Promise<
	{ serviceCodeId: string; prefilledQty: number; qty: number }[] | null
> {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!Array.isArray(parsed)) return null
	const submitted = new Map<string, number>()
	for (const line of parsed) {
		if (
			!line ||
			typeof line.serviceCodeId !== "string" ||
			!line.serviceCodeId ||
			!Number.isInteger(line.qty) ||
			line.qty < 0 ||
			line.qty > 10_000 ||
			submitted.has(line.serviceCodeId)
		)
			return null
		submitted.set(line.serviceCodeId, line.qty)
	}
	const limitRows =
		dropFt !== undefined && Number.isFinite(dropFt)
			? await db.limitTable.findMany()
			: []
	const brackets = [...new Set(limitRows.map((r) => r.bracketFt))]
	const prefill =
		brackets.length > 0
			? prefillAccessories(limitRows, pickBracket(dropFt as number, brackets))
			: []
	const prefilled = new Map(
		prefill.map((p) => [p.serviceCodeId, p.prefilledQty]),
	)
	// A prefilled line the client left out was edited down to nothing.
	const lines = [...new Set([...prefilled.keys(), ...submitted.keys()])].map(
		(serviceCodeId) => ({
			serviceCodeId,
			prefilledQty: prefilled.get(serviceCodeId) ?? 0,
			qty: submitted.get(serviceCodeId) ?? 0,
		}),
	)
	return lines
}

export async function action({ request }: Route.ActionArgs) {
	const { user, van } = await requireInstaller(request)
	const offline = request.headers.get("X-Offline-Sync") === "true"
	if (!van?.active) {
		if (offline) return data({ conflict: "VAN_INACTIVE" }, { status: 409 })
		return { errorKey: "installer.completion.errors.no_van" as const }
	}
	const form = await request.formData()

	const claroOrderNoRaw = form.get("claroOrderNo")
	if (typeof claroOrderNoRaw !== "string" || !claroOrderNoRaw.trim()) {
		return {
			errorKey: "installer.completion.errors.order_no_required" as const,
		}
	}
	const addressRaw = form.get("address")
	if (typeof addressRaw !== "string" || !addressRaw.trim()) {
		return { errorKey: "installer.completion.errors.address_required" as const }
	}

	// Same edit-log pattern as the crew field page: the client says what the
	// address was before it was changed; the server stamps who and when.
	const addressOriginal = (form.get("addressOriginal") as string | null)?.trim()
	const addressFinal = addressRaw.trim()
	const addressEditLog =
		addressOriginal && addressOriginal !== addressFinal
			? mergeAddressCorrections({
					existing: null,
					correction: buildAddressCorrection({
						original: addressOriginal,
						corrected: addressFinal,
						correctedById: user.id,
					}),
				})
			: undefined

	// The client only says what quantity it wants per code. What the limit
	// table pre-filled is recomputed here from the drop footage, so a forged
	// prefilledQty cannot hide an edit.
	const dropFtRaw = form.get("dropFt")
	const dropFt = dropFtRaw ? Number(dropFtRaw) : undefined
	const accessories = await resolveAccessories(
		(form.get("accessories") as string) || "[]",
		dropFt,
	)
	if (!accessories) {
		return {
			errorKey: "installer.completion.errors.invalid_accessories" as const,
		}
	}

	let formPhotoPath: string | undefined
	const formPhoto = form.get("formPhoto")
	if (formPhoto instanceof File && formPhoto.size > 0) {
		const validation = validateFile(formPhoto, "photo")
		if (!validation.valid) return { errorMessage: validation.error }
		const dir = path.join(
			process.env.UPLOAD_DIR || "/tmp/jaf/uploads",
			"completions",
			"photos",
		)
		await fs.mkdir(dir, { recursive: true })
		const filename = `${Date.now()}-${formPhoto.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
		formPhotoPath = path.join(dir, filename)
		await fs.writeFile(
			formPhotoPath,
			Buffer.from(await formPhoto.arrayBuffer()),
		)
	}

	const res = await submitCompletion(
		{
			idempotencyKey: form.get("idempotencyKey") as string,
			claroOrderNo: (form.get("claroOrderNo") as string).trim(),
			installerId: user.id,
			vanId: van.id,
			address: addressFinal,
			addressEditLog,
			dropFt,
			accessories,
			groundRod: form.get("groundRod") !== "false",
			serialInstalled: (form.get("serialInstalled") as string) || undefined,
			serialUnreadable: form.get("serialUnreadable") === "true",
			modelResolved: (form.get("modelResolved") as string) || undefined,
			// Only a path this action itself just wrote (from an uploaded File,
			// online or reattached from the offline queue) is ever trusted — never
			// a client-supplied string, which would let a crafted request claim
			// an arbitrary file (including someone else's) as this record's photo.
			formPhotoPath,
			sigInstaller: (form.get("sigInstaller") as string) || undefined,
			installedAt: new Date(),
		},
		{ id: user.id },
	)
	if (offline) return data({ ok: true, ...res }, { status: 200 })
	throw redirect("/installer")
}

export default function NewCompletion({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		van,
		brackets,
		limitRows,
		serializedCodes,
		accessoryCodes,
		vanSerials,
	} = loaderData
	const { t } = useTranslation()
	const online = useOnline()
	const sigRef = useRef<SignaturePadHandle>(null)
	const [scanning, setScanning] = useState(false)
	const [serial, setSerial] = useState("")
	const [serialUnreadable, setSerialUnreadable] = useState(false)
	const [modelResolved, setModelResolved] = useState<string | null>(null)
	const [dropFt, setDropFt] = useState<number | "">("")
	const [claroOrderNo, setClaroOrderNo] = useState("")
	const [address, setAddress] = useState("")
	const [idempotencyKey] = useState(() => crypto.randomUUID())

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
		setScanning(false)
	}

	return (
		<div className="space-y-6 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("installer.completion.new_heading", "New Completion")}
			</h1>
			<CompletionStepRail current={step} />
			<Callout title={t("installer.installer_flow.callout.new_title")}>
				{t("installer.installer_flow.callout.new_body")}
			</Callout>

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
					<div className="space-y-1">
						<Label htmlFor="claroOrderNo">
							{t("installer.completion.order_no", "Order #")}
						</Label>
						<Input
							id="claroOrderNo"
							name="claroOrderNo"
							className="h-11 text-base"
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
							className="h-11 text-base"
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
							<div className="flex items-center gap-2">
								<span className="text-sm">
									{serialUnreadable
										? t(
												"installer.completion.serial_unreadable",
												"Unreadable — photo only",
											)
										: serial ||
											t("installer.completion.no_serial", "No serial scanned")}
								</span>
								<Button
									type="button"
									variant="outline"
									size="lg"
									className="h-11 text-base"
									onClick={() => setScanning(true)}
								>
									{t("installer.completion.scan", "Scan")}
								</Button>
							</div>
						)}
					</div>

					{serial !== "" &&
						!serialUnreadable &&
						!vanSerials.includes(serial) && (
							<Callout
								tone="warn"
								title={t("installer.completion.serial_not_on_van_title")}
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
							className="h-11 text-base"
							min={0}
							value={dropFt}
							onChange={(e) =>
								setDropFt(e.target.value === "" ? "" : Number(e.target.value))
							}
						/>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="groundRod"
							name="groundRod"
							defaultChecked
							value="true"
						/>
						<Label htmlFor="groundRod" className="text-sm">
							{t("installer.completion.ground_rod", "Ground rod installed")}
						</Label>
					</div>

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
						</div>
					)}
				</div>

				<div className={panel(3)}>
					<div className="space-y-1">
						<Label htmlFor="formPhoto">
							{t("installer.completion.form_photo", "Claro form photo")}
						</Label>
						<Input
							id="formPhoto"
							name="formPhoto"
							type="file"
							accept="image/*"
							capture="environment"
							className="h-auto text-base"
							required
							onChange={(e) =>
								setFormPhotoName(e.target.files?.[0]?.name ?? "")
							}
						/>
					</div>

					<div className="space-y-1">
						<Label>
							{t("installer.completion.signature", "Installer signature")}
						</Label>
						<SignaturePad ref={sigRef} />
					</div>
				</div>

				<div className="flex gap-2">
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
							className="h-12 flex-[2] text-base"
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
							{t("installer.completion.next", "Next")}
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
