import { readFile } from "node:fs/promises"
import { zipSync } from "fflate"
import { uniqueFileNames } from "./package-files"

/** A missing or unreadable file is skipped: the rest of the package still goes. */
const readOrNull = (file: string) => readFile(file).catch(() => null)

/**
 * "Download all (zip)": every package file, byte for byte as stored (no
 * conversion, no re-encoding), one flat folder. A repeated name is numbered
 * (`a.jpg`, `a-2.jpg`); a file that cannot be read is left out.
 */
export async function zipPackage(
	files: { name: string; path: string }[],
): Promise<Buffer> {
	const present: { name: string; data: Uint8Array }[] = []
	for (const f of files) {
		const data = await readOrNull(f.path)
		if (data) present.push({ name: f.name, data: new Uint8Array(data) })
	}
	const names = uniqueFileNames(present.map((f) => f.name))
	const entries: Record<string, Uint8Array> = {}
	present.forEach((f, i) => {
		entries[names[i]] = f.data
	})
	// Photos and PDFs are already compressed: store them as they are.
	return Buffer.from(zipSync(entries, { level: 0 }))
}
