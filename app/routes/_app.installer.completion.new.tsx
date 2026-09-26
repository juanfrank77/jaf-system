import fs from "node:fs/promises"
import path from "node:path"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, redirect } from "react-router"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { useOnline } from "~/hooks/use-online"
import { submitCompletion } from "~/lib/completion-submit.server"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { queueCompletion } from "~/lib/installer-completion-sync"
import { requireInstaller } from "~/lib/installer-context.server"
import { pickBracket, prefillAccessories } from "~/lib/limit-table"
import { getSerializedCodes, resolveSerial } from "~/lib/service-codes.server"
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
	return { user, van, brackets, limitRows, serializedCodes }
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

	const accessories = JSON.parse((form.get("accessories") as string) || "[]")

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
			address: (form.get("address") as string).trim(),
			dropFt: form.get("dropFt") ? Number(form.get("dropFt")) : undefined,
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

export default function NewCompletion({ loaderData }: Route.ComponentProps) {
	const { van, brackets, limitRows, serializedCodes } = loaderData
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
	const accessories =
		bracket != null
			? prefillAccessories(
					limitRows.map((r) => ({
						bracketFt: r.bracketFt,
						serviceCodeId: r.serviceCodeId,
						qty: r.qty,
					})),
					bracket,
				)
			: []

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

				<div className="space-y-1">
					<Label htmlFor="claroOrderNo">
						{t("installer.completion.order_no", "Order #")}
					</Label>
					<Input
						id="claroOrderNo"
						name="claroOrderNo"
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
						required
						value={address}
						onChange={(e) => setAddress(e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label>{t("installer.completion.scan_heading", "Scan modem")}</Label>
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
								onClick={() => setScanning(true)}
							>
								{t("installer.completion.scan", "Scan")}
							</Button>
						</div>
					)}
				</div>

				<div className="space-y-1">
					<Label htmlFor="dropFt">
						{t("installer.completion.drop_ft", "Drop (ft)")}
					</Label>
					<Input
						id="dropFt"
						name="dropFt"
						type="number"
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

				<div className="space-y-1">
					<Label htmlFor="formPhoto">
						{t("installer.completion.form_photo", "Claro form photo")}
					</Label>
					<Input
						id="formPhoto"
						name="formPhoto"
						type="file"
						accept="image/*"
						required
					/>
				</div>

				<div className="space-y-1">
					<Label>
						{t("installer.completion.signature", "Installer signature")}
					</Label>
					<SignaturePad ref={sigRef} />
				</div>

				<Button type="submit">
					{t("installer.completion.submit", "Submit")}
				</Button>
			</form>

			{!van && (
				<p className="text-sm text-amber-600">{t("installer.no_van")}</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
