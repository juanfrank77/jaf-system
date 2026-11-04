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
 * Move an already-saved upload to <UPLOAD_DIR>/<kind>/<filename>; returns the
 * new absolute path. Never overwrites: an existing target throws with
 * `code: "EEXIST"`.
 */
export async function moveUpload(
	from: string,
	kind: string,
	filename: string,
): Promise<string> {
	const dir = path.join(uploadRoot(), kind)
	await fs.mkdir(dir, { recursive: true })
	const localPath = path.join(dir, filename)
	if (await fs.stat(localPath).catch(() => null))
		throw Object.assign(new Error(`Refusing to overwrite ${localPath}`), {
			code: "EEXIST",
		})
	await fs.rename(from, localPath)
	return localPath
}

/** Undo a `moveUpload`: put the file back at its original path. */
export async function restoreUpload(movedTo: string, original: string) {
	await fs.rename(movedTo, original)
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
			const file = photoFile(docId, p.localPath)
			const stat = await fs.stat(file).catch(() => null)
			return !!stat?.isFile() && stat.size > 0
		}),
	)
	return photos.filter((_, i) => loads[i])
}

/** Where a `Photo` row's file is served from: `<UPLOAD_DIR>/photos/<docId>/<basename>`. */
export function photoFile(docId: string, localPath: string): string {
	return path.join(uploadRoot(), "photos", docId, path.basename(localPath))
}
