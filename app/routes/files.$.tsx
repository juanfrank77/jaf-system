import fs from "node:fs/promises"
import path from "node:path"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/files.$"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireSession(request)
	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const filePath = path.join(uploadDir, params["*"] ?? "")

	if (!filePath.startsWith(path.resolve(uploadDir))) {
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
