import fs from "node:fs/promises"
import path from "node:path"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/files.$"

const FINANCEABLE_STATUSES = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_GENERATED",
] as const

const WAREHOUSE_STATUSES = [
	"CREATED",
	"PREPPED",
	"SIGNED",
	"FIELD_UPDATED",
] as const

function extractDocId(relativePath: string): string | null {
	const segments = relativePath.split("/")
	if (segments.length >= 2 && segments[0] === "photos") {
		return segments[1] || null
	}
	const fileName = segments[segments.length - 1] || ""
	const docId = fileName.split("-")[0] || null
	return docId
}

function canAccessDoc(
	doc: {
		status: string
		supervisorId: string
		assignedCrewIds: string[]
	},
	userRole: string,
	userId: string,
): boolean {
	if (userRole === "ADMIN") return true
	if (userRole === "SUPERVISOR") return doc.supervisorId === userId
	if (userRole === "CREW") return doc.assignedCrewIds.includes(userId)
	if (userRole === "WAREHOUSE")
		return WAREHOUSE_STATUSES.includes(doc.status as any)
	if (userRole === "FINANCE" || userRole === "COMPTROLLER")
		return FINANCEABLE_STATUSES.includes(doc.status as any)
	return false
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

	const docId = extractDocId(params["*"] ?? "")
	if (!docId) {
		return new Response("Forbidden", { status: 403 })
	}

	const doc = await db.jafInvoice.findUnique({
		where: { id: docId },
		select: {
			status: true,
			supervisorId: true,
			assignedCrewIds: true,
		},
	})

	if (!doc || !canAccessDoc(doc, user.role, user.id)) {
		return new Response("Forbidden", { status: 403 })
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
						: "application/octet-stream"
		return new Response(new Uint8Array(bytes), {
			headers: { "Content-Type": contentType },
		})
	} catch {
		return new Response("Not found", { status: 404 })
	}
}
