/**
 * Read-only inspection for supervisor-money-access (#28) legacy data impact.
 * Run BEFORE deploying the aviso guard PR on staging/production:
 *
 *   pnpm exec tsx scripts/inspect-aviso-guard-impact.ts
 *
 * No writes.
 */
import { avisoAmountMatch } from "../app/lib/aviso-guard.server"
import { db } from "../app/lib/db.server"
import { getAvisoAmountTolerance } from "../app/lib/system-settings.server"
function isEmptyAvisoLines(avisoLines: unknown): boolean {
	if (!avisoLines || !Array.isArray(avisoLines)) return true
	return avisoLines.length === 0
}

type Row = {
	id: string
	controlNumber: string
	status: string
	releasedToFinanceAt: Date | null
	avisoMatchedAt: Date | null
	claroPdfPath: string | null
	reason: string
}

async function main() {
	const tolerance = await getAvisoAmountTolerance()
	const docs = await db.jafInvoice.findMany({
		where: {
			OR: [
				{ status: { in: ["CLARO_UPLOADED", "LC_REQUEST_GENERATED"] } },
				{ releasedToFinanceAt: { not: null } },
				{ avisoMatchedAt: { not: null } },
				{ claroPdfPath: { not: null } },
			],
		},
		select: {
			id: true,
			controlNumber: true,
			status: true,
			releasedToFinanceAt: true,
			avisoMatchedAt: true,
			claroPdfPath: true,
			jafInvoiceLines: true,
			avisoLines: true,
		},
		orderBy: { controlNumber: "asc" },
	})

	const categoryA: Row[] = []
	const categoryB: Row[] = []
	const categoryC: Row[] = []

	for (const doc of docs) {
		const match = avisoAmountMatch(doc, tolerance)
		const inScope =
			doc.status === "CLARO_UPLOADED" ||
			doc.status === "LC_REQUEST_GENERATED" ||
			doc.releasedToFinanceAt != null

		if (inScope && !match.amountOk) {
			categoryA.push({
				id: doc.id,
				controlNumber: doc.controlNumber,
				status: doc.status,
				releasedToFinanceAt: doc.releasedToFinanceAt,
				avisoMatchedAt: doc.avisoMatchedAt,
				claroPdfPath: doc.claroPdfPath,
				reason: isEmptyAvisoLines(doc.avisoLines)
					? "empty_or_null_aviso_lines"
					: "amount_mismatch",
			})
		}

		if (doc.claroPdfPath && isEmptyAvisoLines(doc.avisoLines)) {
			categoryB.push({
				id: doc.id,
				controlNumber: doc.controlNumber,
				status: doc.status,
				releasedToFinanceAt: doc.releasedToFinanceAt,
				avisoMatchedAt: doc.avisoMatchedAt,
				claroPdfPath: doc.claroPdfPath,
				reason: "claro_pdf_without_aviso_lines",
			})
		}

		if (doc.avisoMatchedAt && !match.amountOk) {
			categoryC.push({
				id: doc.id,
				controlNumber: doc.controlNumber,
				status: doc.status,
				releasedToFinanceAt: doc.releasedToFinanceAt,
				avisoMatchedAt: doc.avisoMatchedAt,
				claroPdfPath: doc.claroPdfPath,
				reason: isEmptyAvisoLines(doc.avisoLines)
					? "stale_stamp_empty_lines"
					: "stale_stamp_mismatch",
			})
		}
	}

	const summary = {
		tolerance,
		scanned: docs.length,
		categoryA: {
			label:
				"CLARO_UPLOADED / LC_REQUEST_GENERATED / released — would fail assertAvisoAmountMatches",
			count: categoryA.length,
			controlNumbers: categoryA.map((r) => r.controlNumber),
			rows: categoryA,
		},
		categoryB: {
			label: "upload_claro path (claroPdfPath set, avisoLines empty)",
			count: categoryB.length,
			controlNumbers: categoryB.map((r) => r.controlNumber),
			rows: categoryB,
		},
		categoryC: {
			label: "avisoMatchedAt set but lines fail match today",
			count: categoryC.length,
			controlNumbers: categoryC.map((r) => r.controlNumber),
			rows: categoryC,
		},
	}

	console.log(JSON.stringify(summary, null, 2))
}

main()
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
	.finally(async () => {
		await db.$disconnect()
	})
