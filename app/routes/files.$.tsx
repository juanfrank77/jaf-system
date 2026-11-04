import fs from "node:fs/promises"
import path from "node:path"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { supervisorAreas } from "~/lib/supervisor-scope"
import type { Route } from "./+types/files.$"

const FINANCEABLE_STATUSES = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
] as const

const WAREHOUSE_STATUSES = [
	"CREATED",
	"PREPPED",
	"SIGNED",
	"FIELD_UPDATED",
] as const

/**
 * Old priced JAF invoices (the retired generate_jaf_invoice step). They carry
 * unit prices and totals, so only the finance-side roles may read them, on
 * top of the usual per-job check. COMPTROLLER keeps the Finance-level access
 * it already had here (financeable statuses only).
 */
const PRICED_FOLDER = "jaf-invoices/"
const PRICED_ROLES = ["FINANCE", "ADMIN", "COMPTROLLER"]

/** Upload folders kept per job: `<kind>/<docId>/<file>`. */
const PER_DOC_FOLDERS = ["photos", "blueprints"]

function extractDocId(relativePath: string): string | null {
	const segments = relativePath.split("/")
	if (segments.length >= 2 && PER_DOC_FOLDERS.includes(segments[0])) {
		return segments[1] || null
	}
	const fileName = segments[segments.length - 1] || ""
	const docId = fileName.split("-")[0] || null
	return docId
}

/**
 * The stored Prefield PDF and the job's blueprints are for the supervisor and
 * the brigade, not Finance or the Comptroller.
 */
const PACKET_PREFIELD = /^packets\/[^/]*-prefield-[^/]*$/
const FINANCE_SIDE_ROLES = ["FINANCE", "COMPTROLLER"]
function isFinanceHiddenFile(normalized: string): boolean {
	return (
		normalized.startsWith("blueprints/") || PACKET_PREFIELD.test(normalized)
	)
}

async function canAccessDoc(
	doc: {
		status: string
		supervisorId: string
		brigade: { area: string | null } | null
	},
	userRole: string,
	userId: string,
): Promise<boolean> {
	if (userRole === "ADMIN") return true
	// The same scope as every supervisor job screen: the job's own supervisor,
	// or one whose admin-assigned areas cover the job's brigade.
	if (userRole === "SUPERVISOR") {
		if (doc.supervisorId === userId) return true
		const area = doc.brigade?.area
		return !!area && (await supervisorAreas(db, userId)).includes(area)
	}
	// CREW falls through to false: crew accounts no longer sign in.
	if (userRole === "WAREHOUSE")
		// biome-ignore lint/suspicious/noExplicitAny: status narrowed below
		return WAREHOUSE_STATUSES.includes(doc.status as any)
	if (userRole === "FINANCE")
		// biome-ignore lint/suspicious/noExplicitAny: status narrowed below
		return FINANCEABLE_STATUSES.includes(doc.status as any)
	if (userRole === "COMPTROLLER")
		// biome-ignore lint/suspicious/noExplicitAny: status narrowed below
		return FINANCEABLE_STATUSES.includes(doc.status as any)
	return false
}

async function canAccessCompletionFile(
	relativePath: string,
	absolutePath: string,
	user: { id: string; role: string },
): Promise<boolean> {
	if (user.role === "ADMIN" || user.role === "INSTALLER_SUPERVISOR") {
		const pdfMatch = relativePath.match(/^completions\/([^/]+)\.pdf$/)
		if (pdfMatch) {
			const completion = await db.installCompletion.findUnique({
				where: { id: pdfMatch[1] },
			})
			return Boolean(completion)
		}
		const photo = await db.installCompletion.findFirst({
			where: {
				formPhotoPath: absolutePath,
			},
		})
		return Boolean(photo)
	}
	if (user.role === "INSTALLER") {
		const pdfMatch = relativePath.match(/^completions\/([^/]+)\.pdf$/)
		if (pdfMatch) {
			const completion = await db.installCompletion.findUnique({
				where: { id: pdfMatch[1] },
			})
			return completion?.installerId === user.id
		}
		const photo = await db.installCompletion.findFirst({
			where: {
				installerId: user.id,
				formPhotoPath: absolutePath,
			},
		})
		return Boolean(photo)
	}
	return false
}

async function canAccessRepairBatchFile(
	relativePath: string,
	user: { id: string; role: string },
): Promise<boolean> {
	const m = relativePath.match(/^repair-batches\/([^/]+)\.pdf$/)
	if (!m) return false
	const batch = await db.repairBatch.findUnique({
		where: { id: m[1] },
		select: { warehouseId: true },
	})
	if (!batch) return false
	if (user.role === "ADMIN") return true
	if (user.role === "WAREHOUSE") {
		const a = await db.warehouseAssignment.findUnique({
			where: {
				userId_warehouseId: { userId: user.id, warehouseId: batch.warehouseId },
			},
			select: { userId: true },
		})
		return Boolean(a)
	}
	return false
}

async function canAccessSnapshotFile(
	relativePath: string,
	user: { id: string; role: string },
): Promise<boolean> {
	const m = relativePath.match(/^snapshots\/([^/]+)\.(pdf|csv)$/)
	if (!m) return false
	const snap = await db.stockSnapshot.findUnique({
		where: { id: m[1] },
		select: { warehouseId: true },
	})
	if (!snap) return false
	if (user.role === "ADMIN") return true
	if (user.role === "WAREHOUSE") {
		const a = await db.warehouseAssignment.findUnique({
			where: {
				userId_warehouseId: { userId: user.id, warehouseId: snap.warehouseId },
			},
			select: { userId: true },
		})
		return Boolean(a)
	}
	return false
}

/**
 * ACH evidence uploaded against a payroll run close, stored as
 * `payroll-runs/<runId>-<uuid>.<ext>`. Finance-side only: the file is a bank
 * confirmation, and the run id prefix is only honoured for the finance-side
 * roles.
 *
 * The comptroller (an always-on role) may also read run evidence: Carmen
 * verifies the ACH confirmation when she works a payroll run.
 */
async function canAccessPayrollRunFile(
	relativePath: string,
	user: { id: string; role: string },
): Promise<boolean> {
	const m = relativePath.match(/^payroll-runs\/([^/]+)-/)
	if (!m) return false
	return (
		user.role === "ADMIN" ||
		user.role === "FINANCE" ||
		user.role === "COMPTROLLER"
	)
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const resolvedUploadDir = path.resolve(uploadDir)
	const filePath = path.join(resolvedUploadDir, params["*"] ?? "")

	if (
		filePath !== resolvedUploadDir &&
		!filePath.startsWith(resolvedUploadDir + path.sep)
	) {
		return new Response("Forbidden", { status: 403 })
	}

	const relativePath = params["*"] ?? ""
	if (relativePath.startsWith("completions/")) {
		const allowed = await canAccessCompletionFile(relativePath, filePath, user)
		if (!allowed) return new Response("Forbidden", { status: 403 })
	} else if (relativePath.startsWith("repair-batches/")) {
		const allowed = await canAccessRepairBatchFile(relativePath, user)
		if (!allowed) return new Response("Forbidden", { status: 403 })
	} else if (relativePath.startsWith("snapshots/")) {
		const allowed = await canAccessSnapshotFile(relativePath, user)
		if (!allowed) return new Response("Forbidden", { status: 403 })
	} else if (relativePath.startsWith("payroll-runs/")) {
		const allowed = await canAccessPayrollRunFile(relativePath, user)
		if (!allowed) return new Response("Forbidden", { status: 403 })
	} else {
		// On the resolved path, so `packets/../jaf-invoices/…` cannot dodge it.
		const normalized = path
			.relative(resolvedUploadDir, filePath)
			.split(path.sep)
			.join("/")
		if (
			normalized.startsWith(PRICED_FOLDER) &&
			!PRICED_ROLES.includes(user.role)
		)
			return new Response("Forbidden", { status: 403 })
		if (
			FINANCE_SIDE_ROLES.includes(user.role) &&
			isFinanceHiddenFile(normalized)
		)
			return new Response("Forbidden", { status: 403 })
		const docId = extractDocId(relativePath)
		if (!docId) {
			return new Response("Forbidden", { status: 403 })
		}

		const doc = await db.jafInvoice.findUnique({
			where: { id: docId },
			select: {
				status: true,
				supervisorId: true,
				brigade: { select: { area: true } },
			},
		})

		if (!doc || !(await canAccessDoc(doc, user.role, user.id))) {
			return new Response("Forbidden", { status: 403 })
		}
	}

	try {
		const bytes = await fs.readFile(filePath)
		const ext = path.extname(filePath).toLowerCase()
		const contentType =
			ext === ".pdf"
				? "application/pdf"
				: ext === ".png"
					? "image/png"
					: ext === ".jpg" || ext === ".jpeg"
						? "image/jpeg"
						: ext === ".csv"
							? "text/csv"
							: "application/octet-stream"
		return new Response(new Uint8Array(bytes), {
			headers: { "Content-Type": contentType },
		})
	} catch {
		return new Response("Not found", { status: 404 })
	}
}
