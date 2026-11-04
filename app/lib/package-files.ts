import { isPacketPath } from "./release-gate"
import { uploadHref } from "./upload-href"

/**
 * One file of the package the supervisor sends to Claro at step 5 (spec
 * "Packet → Claro"): the JAF work order PDF, the Claro Prefield PDF (only when
 * the job needs it) and the original photo and blueprint files, as uploaded.
 * The Aviso and the Certificado come back from Claro later and are never in it.
 */
export type PackageFile = {
	key: "work_order_pdf" | "prefield_pdf" | "photo" | "blueprint"
	/** The file name as stored (photos and blueprints: as uploaded). */
	name: string
	/**
	 * What the supervisor and Claro see: the list, the download, the zip entry
	 * and the email attachment ("JAF work order MAINT-261026-025.pdf",
	 * "Photo 1 - before.jpg"). The stored names are system names.
	 */
	fileName: string
	/** Where the server reads it. */
	path: string
	/** Where the browser downloads it (`/files/...`). */
	href: string
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

const extension = (p: string) => {
	const dot = basename(p).lastIndexOf(".")
	return dot > 0 ? basename(p).slice(dot).toLowerCase() : ""
}

/**
 * The package, in order: work order PDF, Prefield PDF, photos by the time they
 * were taken, then blueprints. `photos[].localPath` is the file the viewer
 * serves (`<UPLOAD_DIR>/photos/<docId>/<basename>`).
 */
export function packageFiles(
	doc: {
		id: string
		controlNumber: string
		jafInvoicePdfPath: string | null
		prefieldPdfPath: string | null
		prefieldNeeded: boolean
		blueprintPaths: string[]
	},
	photos: { localPath: string; takenAt: Date; tag?: string | null }[],
): PackageFile[] {
	const files: PackageFile[] = []
	if (isPacketPath(doc.jafInvoicePdfPath)) {
		const p = doc.jafInvoicePdfPath as string
		files.push({
			key: "work_order_pdf",
			name: basename(p),
			fileName: `JAF work order ${doc.controlNumber}.pdf`,
			path: p,
			href: uploadHref(p),
		})
	}
	if (doc.prefieldNeeded && isPacketPath(doc.prefieldPdfPath)) {
		const p = doc.prefieldPdfPath as string
		files.push({
			key: "prefield_pdf",
			name: basename(p),
			fileName: `Prefield ${doc.controlNumber}.pdf`,
			path: p,
			href: uploadHref(p),
		})
	}
	const byTime = [...photos].sort(
		(a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime(),
	)
	for (const [i, photo] of byTime.entries()) {
		const name = basename(photo.localPath)
		const tag = photo.tag ? ` - ${photo.tag.toLowerCase()}` : ""
		files.push({
			key: "photo",
			name,
			fileName: `Photo ${i + 1}${tag}${extension(photo.localPath)}`,
			path: photo.localPath,
			href: `/files/photos/${encodeURIComponent(doc.id)}/${encodeURIComponent(name)}`,
		})
	}
	for (const [i, p] of doc.blueprintPaths.entries()) {
		const name = basename(p)
		files.push({
			key: "blueprint",
			name,
			fileName: `Blueprint ${i + 1}${extension(p)}`,
			path: p,
			href: `/files/blueprints/${encodeURIComponent(doc.id)}/${encodeURIComponent(name)}`,
		})
	}
	return files
}

/**
 * The names as given, with a repeat numbered before its extension (`a.jpg`,
 * `a-2.jpg`), so no zip entry or email attachment shadows another.
 */
export function uniqueFileNames(names: string[]): string[] {
	const seen = new Map<string, number>()
	const taken = new Set<string>()
	return names.map((name) => {
		const dot = name.lastIndexOf(".")
		const [stem, ext] =
			dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
		let n = seen.get(name) ?? 0
		let candidate = name
		while (taken.has(candidate)) {
			n += 1
			candidate = `${stem}-${n + 1}${ext}`
		}
		seen.set(name, n)
		taken.add(candidate)
		return candidate
	})
}
