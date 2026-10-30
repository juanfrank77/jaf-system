import { readFile, stat } from "node:fs/promises"
import { degrees, PDFDocument, StandardFonts } from "pdf-lib"
import { jpegOrientation } from "./jpeg-orientation"

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 36
/** One input larger than this is skipped, so the route never runs out of memory. */
const MAX_FILE_BYTES = 40 * 1024 * 1024
/** Input bytes across the whole package; a file that would pass it is skipped. */
const MAX_TOTAL_BYTES = 150 * 1024 * 1024

export type SkipReason = "unsupported" | "unreadable" | "missing" | "too_large"
const REASON_TEXT: Record<SkipReason, string> = {
	unsupported: "unsupported format / formato no compatible",
	unreadable: "unreadable / ilegible",
	missing: "missing / no encontrado",
	too_large: "too large / demasiado grande",
}

const ext = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase()

/**
 * Where an image goes on the page: the EXIF Orientation turns it (3 = 180,
 * 6 = 90 clockwise, 8 = 90 counter-clockwise; the mirrored ones take the turn
 * the EXIF spec pairs them with, 2 = none, 4 = 3's, 5 = 8's, 7 = 6's, and the
 * mirror itself is ignored), then it is scaled down to fit inside the margins,
 * never up, aspect kept. `x`/`y` are the drawImage origin (the image's own
 * bottom-left corner, before rotation); `boxW`/`boxH` the area it covers.
 */
export function placeImage(imgW: number, imgH: number, orientation: number) {
	const quarter =
		orientation === 6 ||
		orientation === 5 ||
		orientation === 8 ||
		orientation === 7
	const dispW = quarter ? imgH : imgW
	const dispH = quarter ? imgW : imgH
	const scale = Math.min(
		1,
		(A4.w - 2 * MARGIN) / dispW,
		(A4.h - 2 * MARGIN) / dispH,
	)
	const width = imgW * scale
	const height = imgH * scale
	const boxW = dispW * scale
	const boxH = dispH * scale
	const bx = (A4.w - boxW) / 2
	const by = (A4.h - boxH) / 2
	switch (orientation) {
		case 3:
		case 4:
			return {
				x: bx + width,
				y: by + height,
				width,
				height,
				rotate: 180,
				boxW,
				boxH,
			}
		case 6:
		case 7:
			return { x: bx, y: by + width, width, height, rotate: -90, boxW, boxH }
		case 8:
		case 5:
			return { x: bx + height, y: by, width, height, rotate: 90, boxW, boxH }
		default:
			return { x: bx, y: by, width, height, rotate: 0, boxW, boxH }
	}
}

const ansi = (s: string) =>
	s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?").slice(0, 90)

export type PackagePdf = {
	pdf: Uint8Array
	/** Pages of real content (report, Prefield, photos), not the skipped list. */
	contentPages: number
	skipped: { name: string; reason: SkipReason }[]
}

/**
 * "Download all": the package as one PDF. PDFs (the incident report, then the
 * Prefield) are appended page by page; each JPEG or PNG photo or blueprint goes
 * on its own A4 page (see placeImage). `files` is in the order `packageFiles`
 * returns. Anything left out (missing, unreadable, unsupported such as .heic,
 * too large) is listed on one final "Not included" page; with no content page
 * at all, no list is added and `contentPages` is 0.
 */
export async function buildPackagePdfDetailed(
	files: { name: string; path: string }[],
	context = "",
	limits: { fileBytes: number; totalBytes: number } = {
		fileBytes: MAX_FILE_BYTES,
		totalBytes: MAX_TOTAL_BYTES,
	},
): Promise<PackagePdf> {
	const out = await PDFDocument.create()
	const skipped: PackagePdf["skipped"] = []
	let total = 0
	let contentPages = 0
	for (const file of files) {
		const skip = (reason: SkipReason) => {
			skipped.push({ name: file.name, reason })
			// biome-ignore lint/suspicious/noConsole: a skipped package file must show in the server log
			console.warn(
				`package pdf${context ? ` ${context}` : ""}: skipped "${file.name}" (${reason})`,
			)
		}
		const e = ext(file.name || file.path)
		const isPdf = e === ".pdf"
		const isPng = e === ".png"
		if (!isPdf && !isPng && e !== ".jpg" && e !== ".jpeg") {
			skip("unsupported")
			continue
		}
		let size: number
		try {
			size = (await stat(file.path)).size
		} catch (err) {
			skip(
				(err as NodeJS.ErrnoException)?.code === "ENOENT"
					? "missing"
					: "unreadable",
			)
			continue
		}
		if (size > limits.fileBytes || total + size > limits.totalBytes) {
			skip("too_large")
			continue
		}
		try {
			const data = await readFile(file.path)
			total += data.length
			if (isPdf) {
				const src = await PDFDocument.load(data, { ignoreEncryption: true })
				const pages = await out.copyPages(src, src.getPageIndices())
				for (const p of pages) out.addPage(p)
				contentPages += pages.length
			} else {
				const img = isPng ? await out.embedPng(data) : await out.embedJpg(data)
				const o = isPng ? 1 : jpegOrientation(data)
				const at = placeImage(img.width, img.height, o)
				const page = out.addPage([A4.w, A4.h])
				page.drawImage(img, {
					x: at.x,
					y: at.y,
					width: at.width,
					height: at.height,
					rotate: degrees(at.rotate),
				})
				contentPages += 1
			}
		} catch {
			skip("unreadable")
		}
	}
	if (contentPages > 0 && skipped.length > 0) {
		const font = await out.embedFont(StandardFonts.Helvetica)
		const bold = await out.embedFont(StandardFonts.HelveticaBold)
		let page = out.addPage([A4.w, A4.h])
		let y = A4.h - MARGIN - 18
		page.drawText("Not included in this PDF / No incluido en este PDF", {
			x: MARGIN,
			y,
			size: 16,
			font: bold,
		})
		y -= 32
		for (const s of skipped) {
			if (y < MARGIN) {
				page = out.addPage([A4.w, A4.h])
				y = A4.h - MARGIN - 12
			}
			page.drawText(`${ansi(s.name)} - ${REASON_TEXT[s.reason]}`, {
				x: MARGIN,
				y,
				size: 11,
				font,
			})
			y -= 18
		}
	}
	return { pdf: await out.save(), contentPages, skipped }
}

/** The package as PDF bytes (see buildPackagePdfDetailed). */
export async function buildPackagePdf(
	files: { name: string; path: string }[],
): Promise<Uint8Array> {
	return (await buildPackagePdfDetailed(files)).pdf
}
