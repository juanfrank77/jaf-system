/**
 * Read-only inspection for supervisor deploy safety.
 * Run BEFORE deploying supervisor gate / aviso guard changes on staging/production:
 *
 *   pnpm exec tsx scripts/inspect-aviso-guard-impact.ts
 *
 * No writes. Uses app `db.server` (same adapter as the running app).
 */
import { avisoAmountMatch } from "../app/lib/aviso-guard.server"
import { db } from "../app/lib/db.server"
import {
	expectedReturnQty,
	isReturnsReconciled,
	nothingExpectedBack,
} from "../app/lib/supervisor-stage"
import { getAvisoAmountTolerance } from "../app/lib/system-settings.server"

function isEmptyAvisoLines(avisoLines: unknown): boolean {
	if (!avisoLines || !Array.isArray(avisoLines)) return true
	return avisoLines.length === 0
}

type MaterialQtyLine = { serviceCodeId: string; qty: number }
type ReturnRecordedLine = {
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes?: string
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

function categoryDReason(doc: {
	materialsTaken: unknown
	materialsUsed: unknown
	materialsReturned: unknown
}): string | null {
	if (isReturnsReconciled(
		doc.materialsTaken,
		doc.materialsUsed,
		doc.materialsReturned,
	)) {
		return null
	}
	if (nothingExpectedBack(doc.materialsTaken, doc.materialsUsed)) return null

	if (doc.materialsReturned == null) return "expected_back_no_returns"

	const taken = Array.isArray(doc.materialsTaken)
		? (doc.materialsTaken as MaterialQtyLine[])
		: []
	const usedMap = Object.fromEntries(
		(Array.isArray(doc.materialsUsed)
			? (doc.materialsUsed as MaterialQtyLine[])
			: []
		).map((u) => [u.serviceCodeId, u.qty]),
	)
	const returnedLines = Array.isArray(doc.materialsReturned)
		? (doc.materialsReturned as ReturnRecordedLine[])
		: []

	for (const t of taken) {
		const used = usedMap[t.serviceCodeId] ?? 0
		const expected = expectedReturnQty(t.qty, used)
		if (expected === 0) continue

		const line = returnedLines.find((r) => r.serviceCodeId === t.serviceCodeId)
		if (!line) return "expected_back_no_returns"

		const lineExpected = expectedReturnQty(line.takenQty ?? t.qty, used)
		if (line.returnedQty < lineExpected && !line.notes?.trim()) {
			return "short_without_note"
		}
	}

	return "returns_not_reconciled"
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

	const approvedNotReleased = await db.jafInvoice.findMany({
		where: {
			supervisorApprovedAt: { not: null },
			releasedToFinanceAt: null,
		},
		select: {
			id: true,
			controlNumber: true,
			status: true,
			releasedToFinanceAt: true,
			avisoMatchedAt: true,
			claroPdfPath: true,
			materialsTaken: true,
			materialsUsed: true,
			materialsReturned: true,
		},
		orderBy: { controlNumber: "asc" },
	})

	const categoryD: Row[] = []
	for (const doc of approvedNotReleased) {
		const reason = categoryDReason(doc)
		if (!reason) continue
		categoryD.push({
			id: doc.id,
			controlNumber: doc.controlNumber,
			status: doc.status,
			releasedToFinanceAt: doc.releasedToFinanceAt,
			avisoMatchedAt: doc.avisoMatchedAt,
			claroPdfPath: doc.claroPdfPath,
			reason,
		})
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
		categoryD: {
			label:
				"approved, not released — would fail returns_reconciled (expected back with no returns, or short without note)",
			count: categoryD.length,
			controlNumbers: categoryD.map((r) => r.controlNumber),
			rows: categoryD,
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
