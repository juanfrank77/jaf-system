/**
 * The EXIF Orientation (1..8) of a JPEG, read from its APP1/TIFF header.
 * Anything missing or malformed counts as 1 (upright). Never throws.
 */
export function jpegOrientation(data: Uint8Array): number {
	try {
		if (data[0] !== 0xff || data[1] !== 0xd8) return 1
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
		let pos = 2
		while (pos + 4 <= data.length && data[pos] === 0xff) {
			const marker = data[pos + 1]
			if (marker === 0xda || marker === 0xd9) return 1
			const len = view.getUint16(pos + 2)
			if (len < 2) return 1
			if (
				marker === 0xe1 &&
				len >= 16 &&
				data[pos + 4] === 0x45 && // "Exif\0\0"
				data[pos + 5] === 0x78 &&
				data[pos + 6] === 0x69 &&
				data[pos + 7] === 0x66 &&
				data[pos + 8] === 0 &&
				data[pos + 9] === 0
			) {
				return tiffOrientation(view, pos + 10, pos + 2 + len)
			}
			pos += 2 + len
		}
	} catch {
		// malformed: upright
	}
	return 1
}

function tiffOrientation(view: DataView, tiff: number, end: number): number {
	const order = view.getUint16(tiff)
	if (order !== 0x4949 && order !== 0x4d4d) return 1
	const le = order === 0x4949
	if (view.getUint16(tiff + 2, le) !== 42) return 1
	const ifd = tiff + view.getUint32(tiff + 4, le)
	if (ifd + 2 > end) return 1
	const count = view.getUint16(ifd, le)
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12
		if (entry + 12 > end) return 1
		if (view.getUint16(entry, le) === 0x0112) {
			const value = view.getUint16(entry + 8, le)
			return value >= 1 && value <= 8 ? value : 1
		}
	}
	return 1
}
