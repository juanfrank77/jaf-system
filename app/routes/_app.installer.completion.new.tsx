import fs from "node:fs/promises"
import path from "node:path"
import { data, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { NewCompletionForm } from "~/components/new-completion-form"
import { submitCompletion } from "~/lib/completion-submit.server"
import { db } from "~/lib/db.server"
import {
	buildAddressCorrection,
	mergeAddressCorrections,
} from "~/lib/field-update-helpers"
import { validateFile } from "~/lib/file-upload.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { pickBracket, prefillAccessories } from "~/lib/limit-table"
import { refuse } from "~/lib/offline-validation.server"
import {
	getSerializedCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { Route } from "./+types/_app.installer.completion.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Completion — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user, van, profile } = await requireInstaller(request)
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
		// Read-only identity shown on step 1; the server stamps the real
		// installer and submit time itself.
		identity: {
			name: user.name,
			jafNumber: profile?.jafNumber || null,
			login: user.email || null,
		},
		van,
		brackets,
		limitRows,
		// Model resolution needs the prefix and name, never the price.
		serializedCodes: serviceCodesForRole(user.role, serializedCodes),
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
		return refuse(request, {
			errorKey: "installer.completion.errors.no_van" as const,
		})
	}
	const form = await request.formData()

	const claroOrderNoRaw = form.get("claroOrderNo")
	if (typeof claroOrderNoRaw !== "string" || !claroOrderNoRaw.trim()) {
		return refuse(request, {
			errorKey: "installer.completion.errors.order_no_required" as const,
		})
	}
	const addressRaw = form.get("address")
	if (typeof addressRaw !== "string" || !addressRaw.trim()) {
		return refuse(request, {
			errorKey: "installer.completion.errors.address_required" as const,
		})
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
		return refuse(request, {
			errorKey: "installer.completion.errors.invalid_accessories" as const,
		})
	}

	let formPhotoPath: string | undefined
	const formPhoto = form.get("formPhoto")
	if (formPhoto instanceof File && formPhoto.size > 0) {
		const validation = validateFile(formPhoto, "photo")
		if (!validation.valid)
			return refuse(request, { errorMessage: validation.error })
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

export default function NewCompletion(props: Route.ComponentProps) {
	return <NewCompletionForm {...props} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
