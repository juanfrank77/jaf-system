import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { createWorker, PSM } from "tesseract.js"
import { parseOcrPasses } from "~/lib/po-ocr-parse"
import type { PoRead } from "~/lib/po-reading"
import { isSoundPoRead, type PdfText, parsePoText } from "~/lib/po-text-parse"

/** Reads one PO PDF. Injected so tests and a future mailbox feed share the screen. */
export type PoReader = (pdf: Uint8Array) => Promise<PoRead>

const require = createRequire(import.meta.url)
/** A PO longer than this is read only this far; the page-count check blocks the rest. */
const MAX_PAGES = 12
const RENDER_SCALE = 3

/**
 * Everything runs on this server: Tesseract (WASM) reads the page images and
 * the language data ships in node_modules, so nothing is fetched at runtime.
 */
const tessLangPath = () =>
	process.env.TESSDATA_DIR ||
	path.join(
		path.dirname(require.resolve("@tesseract.js-data/eng/package.json")),
		"4.0.0_best_int",
	)

const pdfjsDir = () => path.dirname(require.resolve("pdfjs-dist/package.json"))

/** Black-and-white at Otsu's threshold: scans with grey backgrounds read far better. */
function binarize(png: Buffer): Promise<Buffer> {
	return loadImage(png).then((img) => {
		const canvas = createCanvas(img.width, img.height)
		const ctx = canvas.getContext("2d")
		ctx.drawImage(img, 0, 0)
		const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const px = image.data
		const hist = new Array<number>(256).fill(0)
		for (let i = 0; i < px.length; i += 4)
			hist[Math.round(0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2])]++
		const total = px.length / 4
		let sum = 0
		for (let t = 0; t < 256; t++) sum += t * hist[t]
		let wB = 0
		let sumB = 0
		let best = 0
		let threshold = 128
		for (let t = 0; t < 256; t++) {
			wB += hist[t]
			if (wB === 0) continue
			const wF = total - wB
			if (wF === 0) break
			sumB += t * hist[t]
			const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
			if (between > best) {
				best = between
				threshold = t
			}
		}
		for (let i = 0; i < px.length; i += 4) {
			const g = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]
			px[i] = px[i + 1] = px[i + 2] = g > threshold ? 255 : 0
		}
		ctx.putImageData(image, 0, 0)
		return canvas.toBuffer("image/png")
	})
}

async function renderPages(pdf: Uint8Array): Promise<Buffer[]> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
	const base = pdfjsDir()
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(pdf),
		wasmUrl: `${path.join(base, "wasm")}/`,
		standardFontDataUrl: `${path.join(base, "standard_fonts")}/`,
	}).promise
	const out: Buffer[] = []
	try {
		for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
			const page = await doc.getPage(n)
			const vp = page.getViewport({ scale: RENDER_SCALE })
			const canvas = createCanvas(vp.width, vp.height)
			await page.render({
				canvas: canvas as never,
				canvasContext: canvas.getContext("2d") as never,
				viewport: vp,
			}).promise
			out.push(canvas.toBuffer("image/png"))
		}
	} finally {
		await doc.cleanup()
	}
	return out
}

const PASSES = [
	{ binary: true, psm: PSM.SINGLE_BLOCK },
	{ binary: true, psm: PSM.SPARSE_TEXT },
	{ binary: false, psm: PSM.SPARSE_TEXT },
	{ binary: false, psm: PSM.AUTO },
] as const

/** OCR a scanned PDF four ways per page: one text per way, all pages joined. */
export async function ocrPdfPasses(pdf: Uint8Array): Promise<string[]> {
	const pages = await renderPages(pdf)
	const binary = await Promise.all(pages.map(binarize))
	const worker = await createWorker("eng", 1, {
		langPath: tessLangPath(),
		gzip: true,
		cachePath: path.join(os.tmpdir(), "jaf-tesseract"),
	})
	try {
		const texts: string[] = []
		for (const pass of PASSES) {
			await worker.setParameters({
				tessedit_pageseg_mode: pass.psm,
				preserve_interword_spaces: "1",
			})
			let text = ""
			for (const img of pass.binary ? binary : pages)
				text += `${(await worker.recognize(img)).data.text}\n`
			texts.push(text)
		}
		return texts
	} finally {
		await worker.terminate()
	}
}

/** The PDF's own text with its position: Claro's system prints POs as real text. */
async function pdfText(pdf: Uint8Array): Promise<PdfText[]> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
	const base = pdfjsDir()
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(pdf),
		wasmUrl: `${path.join(base, "wasm")}/`,
		standardFontDataUrl: `${path.join(base, "standard_fonts")}/`,
	}).promise
	const out: PdfText[] = []
	try {
		for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
			const content = await (await doc.getPage(n)).getTextContent()
			for (const item of content.items)
				if ("str" in item && item.str.trim())
					out.push({
						page: n,
						x: item.transform[4],
						y: item.transform[5],
						text: item.str,
					})
		}
	} finally {
		await doc.cleanup()
	}
	return out
}

/** Text layer first: exact and instant. A scan, or a bad embedded layer, goes to OCR. */
const localPoReader: PoReader = async (pdf) => {
	const read = parsePoText(await pdfText(pdf))
	return isSoundPoRead(read) ? read : parseOcrPasses(await ocrPdfPasses(pdf))
}

/** The reader the inbox uses. Always available: nothing leaves the server. */
export function getPoReader(): PoReader {
	return localPoReader
}
