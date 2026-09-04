import fs from "node:fs/promises"
import path from "node:path"

export function uploadRoot(): string {
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
