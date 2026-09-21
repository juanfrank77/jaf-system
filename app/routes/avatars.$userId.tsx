import fs from "node:fs/promises"
import path from "node:path"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/avatars.$userId"

const CONTENT_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
}

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireSession(request)

	const user = await db.user.findUnique({
		where: { id: params.userId },
		select: { image: true },
	})
	if (!user?.image) throw new Response("Not found", { status: 404 })

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const localPath = path.join(uploadDir, user.image)

	let buffer: Buffer
	try {
		buffer = await fs.readFile(localPath)
	} catch {
		throw new Response("Not found", { status: 404 })
	}

	const contentType = CONTENT_TYPES[path.extname(localPath).toLowerCase()]
	return new Response(new Uint8Array(buffer), {
		headers: {
			"Content-Type": contentType || "application/octet-stream",
			"Cache-Control": "private, max-age=300",
		},
	})
}
