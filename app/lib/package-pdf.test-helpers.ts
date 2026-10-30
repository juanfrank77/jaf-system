import { deflateSync } from "node:zlib"
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib"

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
const crc = (b: Buffer) => {
	let c = 0xffffffff
	for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type), data])
	const sum = Buffer.alloc(4)
	sum.writeUInt32BE(crc(body))
	return Buffer.concat([len, body, sum])
}

/** A valid w x h 8-bit grey PNG. */
export function makePng(w: number, h: number): Buffer {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8
	const raw = Buffer.alloc((w + 1) * h, 0x80)
	for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	])
}

/** A 1x1 JPEG with no EXIF. */
export const JPEG = Buffer.from(
	"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
	"base64",
)

/** The JPEG with an EXIF APP1 segment carrying Orientation = `o`. */
export function jpegWithOrientation(o: number): Buffer {
	const tiff = Buffer.alloc(8 + 2 + 12 + 4)
	tiff.write("MM", 0)
	tiff.writeUInt16BE(42, 2)
	tiff.writeUInt32BE(8, 4)
	tiff.writeUInt16BE(1, 8)
	tiff.writeUInt16BE(0x0112, 10)
	tiff.writeUInt16BE(3, 12)
	tiff.writeUInt32BE(1, 14)
	tiff.writeUInt16BE(o, 18)
	const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])
	const head = Buffer.from([0xff, 0xe1, 0, 0])
	head.writeUInt16BE(body.length + 2, 2)
	return Buffer.concat([JPEG.subarray(0, 2), head, body, JPEG.subarray(2)])
}

/**
 * The JPEG (with Orientation `o` when given) claiming to be `w` x `h`: the
 * frame header is rewritten. The scan data stays 1x1, which pdf-lib never
 * decodes, so it is enough to test where a non-square photo is drawn.
 */
export function jpegSized(w: number, h: number, o?: number): Buffer {
	const out = Buffer.from(o ? jpegWithOrientation(o) : JPEG)
	const sof = out.indexOf(Buffer.from([0xff, 0xc0]))
	out.writeUInt16BE(h, sof + 5)
	out.writeUInt16BE(w, sof + 7)
	return out
}

/** The JPEG with an APP1 "Exif" segment whose TIFF part is garbage. */
export function jpegWithGarbageExif(): Buffer {
	const body = Buffer.concat([
		Buffer.from("Exif\0\0", "latin1"),
		Buffer.from("zzzzzzzzzzzzzzzzzz"),
	])
	const head = Buffer.from([0xff, 0xe1, 0, 0])
	head.writeUInt16BE(body.length + 2, 2)
	return Buffer.concat([JPEG.subarray(0, 2), head, body, JPEG.subarray(2)])
}

/** A blank PDF with one page per [w, h]. */
export async function makePdf(sizes: [number, number][]): Promise<Buffer> {
	const d = await PDFDocument.create()
	for (const [w, h] of sizes) d.addPage([w, h])
	return Buffer.from(await d.save())
}

/**
 * What a page draws: the `cm` matrices of its content stream, in order. For
 * one image: translate, rotate (cos sin -sin cos), then scale (w 0 0 h).
 */
export function pageMatrices(
	page: ReturnType<PDFDocument["getPages"]>[number],
) {
	const contents = page.node.Contents()
	const streams =
		contents && "asArray" in contents ? contents.asArray() : [contents]
	let text = ""
	for (const ref of streams) {
		const s = page.doc.context.lookup(ref as never)
		if (s instanceof PDFRawStream)
			text += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
	}
	return [...text.matchAll(/((?:-?[\d.]+ ){6})cm/g)].map((m) =>
		m[1].trim().split(" ").map(Number),
	)
}
