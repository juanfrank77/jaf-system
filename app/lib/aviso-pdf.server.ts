import { extractText } from "unpdf"
import { type AvisoMaterialRow, parseAvisoMaterials } from "./aviso-materials"

/**
 * Step 6 requires one thing from the Aviso PDF: its number, checked against the
 * typed one. The materials table is also read, best-effort (`readAvisoMaterials`):
 * it only ever feeds an advisory discrepancy and never blocks (spec F2). Amounts
 * are never read.
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

/**
 * The merged text layer (no OCR); throws `unreadable` if extraction fails.
 * pdf.js takes ownership of (detaches) the buffer it is given, so it reads a
 * copy: step 6 reads the same bytes twice (number, then materials).
 */
async function extractAvisoText(bytes: Uint8Array): Promise<string> {
	try {
		const { text } = await extractText(bytes.slice(), { mergePages: true })
		return text
	} catch {
		throw new AvisoPdfError("unreadable")
	}
}

/** Extracts the text layer (no OCR) and returns the 8-digit Aviso number. */
export async function readAvisoNumber(bytes: Uint8Array): Promise<string> {
	return avisoNumberFromText(await extractAvisoText(bytes))
}

/** Materials used per the Aviso, or null when they cannot be read with confidence. */
export async function readAvisoMaterials(
	bytes: Uint8Array,
	knownCodes: ReadonlySet<string>,
): Promise<AvisoMaterialRow[] | null> {
	try {
		return parseAvisoMaterials(await extractAvisoText(bytes), knownCodes)
	} catch {
		return null
	}
}
