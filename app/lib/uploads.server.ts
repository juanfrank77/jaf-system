import fs from "node:fs/promises"
import path from "node:path"

function uploadRoot(): string {
	return process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
}

/** Persist an uploaded File as <UPLOAD_DIR>/<kind>/<filename>; returns the absolute path. */
export async function saveUpload(
	kind: string,
	filename: string,
	file: File,
): Promise<string> {
	const dir = path.join(uploadRoot(), kind)
	await fs.mkdir(dir, { recursive: true })
	const localPath = path.join(dir, filename)
	await fs.writeFile(localPath, Buffer.from(await file.arrayBuffer()))
	return localPath
}

/** Persist a generated Buffer the same way (PDF renders). */
export async function saveBuffer(
	kind: string,
	filename: string,
	buffer: Buffer,
): Promise<string> {
	const dir = path.join(uploadRoot(), kind)
	await fs.mkdir(dir, { recursive: true })
	const localPath = path.join(dir, filename)
	await fs.writeFile(localPath, buffer)
	return localPath
}

/**
 * Photos whose file can actually be served. The photo viewer requests
 * `/files/photos/<docId>/<basename>` (see `files.$.tsx`), i.e.
 * `<UPLOAD_DIR>/photos/<docId>/<basename>`, so that is the file checked here:
 * a `Photo` row alone proves nothing when the file is missing or empty.
 */
export async function photosThatLoad<T extends { localPath: string }>(
	docId: string,
	photos: T[],
): Promise<T[]> {
	const loads = await Promise.all(
		photos.map(async (p) => {
			const file = path.join(
				uploadRoot(),
				"photos",
				docId,
				path.basename(p.localPath),
			)
			const stat = await fs.stat(file).catch(() => null)
			return !!stat?.isFile() && stat.size > 0
		}),
	)
	return photos.filter((_, i) => loads[i])
}
