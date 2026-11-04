import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { jpegOrientation } from "./jpeg-orientation"
import {
	buildPackagePdf,
	buildPackagePdfDetailed,
	placeImage,
} from "./package-pdf.server"
import {
	JPEG,
	jpegSized,
	jpegWithGarbageExif,
	jpegWithOrientation,
	makePdf,
	makePng,
	pageMatrices,
} from "./package-pdf.test-helpers"

let dir: string
const A4 = { w: 595.28, h: 841.89 }

beforeAll(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "pkgpdf-"))
	await writeFile(
		path.join(dir, "report.pdf"),
		await makePdf([
			[300, 300],
			[300, 300],
		]),
	)
	await writeFile(path.join(dir, "prefield.pdf"), await makePdf([[400, 400]]))
	await writeFile(path.join(dir, "tall.png"), makePng(100, 400))
	await writeFile(path.join(dir, "wide.png"), makePng(400, 100))
	await writeFile(path.join(dir, "plain.jpg"), JPEG)
	await writeFile(path.join(dir, "o3.jpg"), jpegWithOrientation(3))
	await writeFile(path.join(dir, "o6.jpg"), jpegWithOrientation(6))
	await writeFile(path.join(dir, "o8.jpg"), jpegWithOrientation(8))
	for (const o of [3, 6, 8])
		await writeFile(path.join(dir, `wide-o${o}.jpg`), jpegSized(400, 200, o))
	await writeFile(path.join(dir, "garbage.jpg"), jpegWithGarbageExif())
	await writeFile(path.join(dir, "c.heic"), "not an image")
	await writeFile(path.join(dir, "bad.jpg"), "garbage")
})

afterEach(() => vi.restoreAllMocks())

const f = (n: string, name = n) => ({ name, path: path.join(dir, n) })
const load = async (b: Uint8Array) => PDFDocument.load(b)

describe("buildPackagePdf", () => {
	it("keeps the order: report pages, Prefield, then each photo on its own A4 page", async () => {
		const out = await load(
			await buildPackagePdf([
				f("report.pdf"),
				f("prefield.pdf"),
				f("tall.png"),
				f("wide.png"),
			]),
		)
		const pages = out.getPages()
		expect(pages.map((p) => p.getWidth())).toEqual([
			300,
			300,
			400,
			expect.closeTo(A4.w, 1),
			expect.closeTo(A4.w, 1),
		])
		// Unscaled (fits the page): tall is 100x400, wide is 400x100.
		const [tall, wide] = [pages[3], pages[4]].map((p) => pageMatrices(p)[2])
		expect([tall?.[0], tall?.[3]]).toEqual([100, 400])
		expect([wide?.[0], wide?.[3]]).toEqual([400, 100])
	})

	it("scales a big image down to fit the margins, never up", () => {
		const big = placeImage(2000, 1000, 1)
		expect(big.width).toBeCloseTo(A4.w - 72, 1)
		expect(big.height / big.width).toBeCloseTo(0.5, 5)
		const small = placeImage(10, 20, 1)
		expect([small.width, small.height]).toEqual([10, 20])
	})

	it("rotates by the EXIF orientation: 3, 6 and 8 (and swaps the fitted box for 6 and 8)", async () => {
		const out = await load(
			await buildPackagePdf([
				f("o3.jpg"),
				f("o6.jpg"),
				f("o8.jpg"),
				f("plain.jpg"),
			]),
		)
		const rot = out.getPages().map((p) => {
			const m = pageMatrices(p)
			return m.length >= 2 ? [Math.round(m[1][0]), Math.round(m[1][1])] : null
		})
		// [cos, sin] of 180, -90 and +90 degrees; upright has no rotation (or 1,0)
		expect(rot[0]).toEqual([-1, 0])
		expect(rot[1]).toEqual([0, -1])
		expect(rot[2]).toEqual([0, 1])
		expect(rot[3] === null || (rot[3][0] === 1 && rot[3][1] === 0)).toBe(true)
		// a 400x100 image turned a quarter covers 100x400 and stays centred
		for (const o of [6, 8]) {
			const p = placeImage(400, 100, o)
			expect([p.boxW, p.boxH]).toEqual([100, 400])
		}
		const p3 = placeImage(400, 100, 3)
		expect([p3.boxW, p3.boxH]).toEqual([400, 100])
	})

	it("draws a non-square photo inside its centred box, turned the right way, for 3, 6 and 8", async () => {
		const out = await load(
			await buildPackagePdf([
				f("wide-o3.jpg"),
				f("wide-o6.jpg"),
				f("wide-o8.jpg"),
			]),
		)
		// Where the image's own corners land: compose the page's cm matrices
		// (translate, rotate, scale) and map the unit square through them.
		const corners = (page: ReturnType<typeof out.getPages>[number]) => {
			const ms = pageMatrices(page)
			const at = (u: number, v: number) => {
				let [x, y] = [u, v]
				for (const [a, b, c, d, e, g] of [...ms].reverse())
					[x, y] = [a * x + c * y + e, b * x + d * y + g]
				return [x, y]
			}
			return {
				bottomLeft: at(0, 0),
				topLeft: at(0, 1),
				topRight: at(1, 1),
				bottomRight: at(1, 0),
			}
		}
		const box = (w: number, h: number) => {
			const x0 = (A4.w - w) / 2
			const y0 = (A4.h - h) / 2
			return { x0, y0, x1: x0 + w, y1: y0 + h }
		}
		const [o3, o6, o8] = out.getPages().map(corners)
		// The content stream rounds to the hundredth: compare within 0.05.
		const at = (got: number[], want: [number, number]) => {
			expect(got[0]).toBeCloseTo(want[0], 1)
			expect(got[1]).toBeCloseTo(want[1], 1)
		}
		// 3: a 400x200 box, upside down (the photo's top-left is bottom-right).
		const b3 = box(400, 200)
		at(o3.topLeft, [b3.x1, b3.y0])
		at(o3.bottomRight, [b3.x0, b3.y1])
		// 6 (turn 90 clockwise) and 8 (90 counter-clockwise): a 200x400 box.
		const bq = box(200, 400)
		at(o6.topLeft, [bq.x1, bq.y1])
		at(o6.bottomRight, [bq.x0, bq.y0])
		at(o8.topLeft, [bq.x0, bq.y0])
		at(o8.bottomRight, [bq.x1, bq.y1])
	})

	it("treats mirrored 5 as 8's turn and 7 as 6's (the mirror itself is ignored)", () => {
		expect(placeImage(400, 200, 5)).toEqual(placeImage(400, 200, 8))
		expect(placeImage(400, 200, 7)).toEqual(placeImage(400, 200, 6))
		expect(placeImage(400, 200, 4)).toEqual(placeImage(400, 200, 3))
		expect(placeImage(400, 200, 2)).toEqual(placeImage(400, 200, 1))
	})

	it("reads the orientation; none or garbage EXIF is upright and still embeds", async () => {
		expect(jpegOrientation(JPEG)).toBe(1)
		expect(jpegOrientation(jpegWithGarbageExif())).toBe(1)
		expect(jpegOrientation(jpegWithOrientation(6))).toBe(6)
		expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1)
		const r = await buildPackagePdfDetailed([f("plain.jpg"), f("garbage.jpg")])
		expect(r.contentPages).toBe(2)
		expect(r.skipped).toEqual([])
	})

	it("lists skipped files on one final page and warns, with the reasons", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const r = await buildPackagePdfDetailed(
			[
				f("report.pdf"),
				f("nope.jpg", "Photo 2.jpg"),
				f("c.heic", "Photo 3.heic"),
				f("bad.jpg", "Photo 4.jpg"),
				f("tall.png"),
			],
			"CTRL-1",
		)
		expect(r.skipped).toEqual([
			{ name: "Photo 2.jpg", reason: "missing" },
			{ name: "Photo 3.heic", reason: "unsupported" },
			{ name: "Photo 4.jpg", reason: "unreadable" },
		])
		expect(r.contentPages).toBe(3)
		expect((await load(r.pdf)).getPageCount()).toBe(4)
		expect(warn).toHaveBeenCalledTimes(3)
		expect(String(warn.mock.calls[0][0])).toContain("CTRL-1")
	})

	it("skips a file over the per-file cap and one that would pass the total cap", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const limits = { fileBytes: 1500, totalBytes: 2500 }
		// report.pdf, prefield.pdf, tall.png are each well under 1500; wide.png too.
		const r = await buildPackagePdfDetailed(
			[f("report.pdf"), f("prefield.pdf"), f("tall.png"), f("wide.png")],
			"",
			{ fileBytes: 100, totalBytes: 1e9 },
		)
		expect(r.skipped.every((s) => s.reason === "too_large")).toBe(true)
		expect(r.contentPages).toBe(0)
		const t = await buildPackagePdfDetailed(
			[f("tall.png"), f("wide.png"), f("report.pdf")],
			"",
			{ fileBytes: limits.fileBytes, totalBytes: 700 },
		)
		expect(t.skipped.map((s) => s.reason)).toContain("too_large")
		expect(t.contentPages).toBeGreaterThan(0)
	})

	it("adds no list page and reports 0 content pages when nothing can be read", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const r = await buildPackagePdfDetailed([f("nope.jpg"), f("c.heic")])
		expect(r.contentPages).toBe(0)
		expect(r.skipped).toHaveLength(2)
		expect((await load(r.pdf)).getPageCount()).toBe(1) // pdf-lib pads an empty doc on load
	})
})
