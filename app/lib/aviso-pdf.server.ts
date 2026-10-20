import { extractText } from "unpdf"

/**
 * Step 6 reads one thing from the Aviso PDF: its number, to check it against
 * the typed one. Rows, quantities and amounts are never read (spec F2).
 */
type AvisoPdfErrorCode = "unreadable" | "no_number" | "multiple_numbers"

export class AvisoPdfError extends Error {
	constructor(readonly code: AvisoPdfErrorCode) {
		super(code)
		this.name = "AvisoPdfError"
	}
}

export const normaliseAvisoNumber = (s: string) => s.replace(/\D/g, "")

/** The one Aviso number in the merged text of a Claro Aviso print. */
export function avisoNumberFromText(text: string): string {
	// No text layer at all: a scan or an image-only PDF.
	if (text.trim() === "") throw new AvisoPdfError("unreadable")
	const numbers = new Set(
		[...text.matchAll(/Aviso\s*#\s*(\d{8})/g)].map((m) => m[1]),
	)
	if (numbers.size === 0) throw new AvisoPdfError("no_number")
	if (numbers.size > 1) throw new AvisoPdfError("multiple_numbers")
	return [...numbers][0]
}

/** Extracts the text layer (no OCR) and returns the 8-digit Aviso number. */
export async function readAvisoNumber(bytes: Uint8Array): Promise<string> {
	let text: string
	try {
		const { text: extracted } = await extractText(bytes, {
			mergePages: true,
		})
		text = extracted
	} catch {
		throw new AvisoPdfError("unreadable")
	}
	return avisoNumberFromText(text)
}
