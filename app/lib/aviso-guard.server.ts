import type { AvisoTransitionContext } from "./permissions"
import type { AvisoLine, InvoiceLine } from "./service-lines"
import { checkAvisoMatch } from "./supervisor-stage"
import { getAvisoAmountTolerance } from "./system-settings.server"

export type AvisoGuardDoc = Pick<
	AvisoTransitionContext,
	"jafInvoiceLines" | "avisoLines"
>

export type { AvisoTransitionContext }

export function avisoAmountMatch(doc: AvisoGuardDoc, tolerance: number) {
	const invoiceLines = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	const avisoLines = (doc.avisoLines as AvisoLine[] | null) ?? []
	if (invoiceLines.length === 0 || avisoLines.length === 0) {
		return {
			amountOk: false,
			difference: Number.POSITIVE_INFINITY,
			invoiceTotal: 0,
			avisoTotal: 0,
			lineMismatches: [],
		}
	}
	return checkAvisoMatch(invoiceLines, avisoLines, tolerance)
}

export function assertAvisoAmountMatches(
	doc: AvisoGuardDoc,
	tolerance: number,
): void {
	const match = avisoAmountMatch(doc, tolerance)
	if (!match.amountOk) {
		throw new AvisoAmountMismatchError(match)
	}
}

export async function assertAvisoAmountMatchesDoc(
	doc: AvisoGuardDoc,
): Promise<void> {
	const tolerance = await getAvisoAmountTolerance()
	assertAvisoAmountMatches(doc, tolerance)
}

export class AvisoAmountMismatchError extends Error {
	readonly code = "AVISO_AMOUNT_MISMATCH" as const

	constructor(readonly match: ReturnType<typeof avisoAmountMatch>) {
		super("Aviso amount does not match invoice lines")
		this.name = "AvisoAmountMismatchError"
	}
}
