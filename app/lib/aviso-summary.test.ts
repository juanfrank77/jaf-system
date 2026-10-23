import { describe, expect, it } from "vitest"
import { type AvisoRaw, summarizeAviso } from "./aviso-summary"
import {
	armAClock,
	claroAging,
	openMoney,
	waitingForPo,
} from "./ledger-reports"

const d = (s: string) => new Date(`${s}T12:00:00Z`)
const NOW = d("2026-10-30")

const base = (over: Partial<AvisoRaw> = {}): AvisoRaw => ({
	id: "a",
	avisoNumber: "10351234",
	controlNumber: "JAF-1",
	address: "Calle 1",
	supervisor: "E. Ocasio",
	brigades: ["204 Norte"],
	zone: "NORTE",
	jobCompletedAt: d("2026-05-01"),
	lines: [{ qty: 1, unitPrice: 800 }],
	releasedAt: d("2026-05-02"),
	acceptedAt: d("2026-05-03"),
	soldAt: d("2026-05-06"),
	batchNumber: 2,
	payrollRequestAt: d("2026-05-09"),
	brigadePaidAt: d("2026-05-13"),
	armBClosedAt: null,
	pos: [],
	...over,
})

const po = (n: string, total: number, poDate: string, inv: object | null) => ({
	poId: n,
	poNumber: n,
	poDate: d(poDate),
	poSubtotal: total,
	poTotal: total,
	poConfirmedAt: d(poDate),
	termsDays: 60,
	invoice: inv as never,
})
const invoice = (seq: number, total: number, over: object = {}) => ({
	id: `i${seq}`,
	seq,
	total,
	madeAt: d("2026-06-24"),
	loadedAt: d("2026-06-24"),
	dueDate: d("2026-08-23"),
	paidAt: null,
	paidNet: null,
	voucherId: null,
	shortAcceptedAt: null,
	...over,
})

describe("summarizeAviso", () => {
	it("works out the Arm A days from sold to brigade paid and marks Arm A closed", () => {
		const s = summarizeAviso(base(), NOW)
		expect(s.armA.days).toBe(7)
		expect(s.armA.closed).toBe(true)
		expect(s.armA.sold.source).toBe("STAMPED")
		expect(s.armA.batchNumber).toBe(2)
	})

	it("splits the JAF invoice by rate from the same money module", () => {
		const s = summarizeAviso(base({ lines: [{ qty: 2, unitPrice: 100 }] }), NOW)
		expect(s.invoice).toEqual({
			subtotal: 200,
			ivu4: 0,
			ivu115: 23,
			total: 223,
		})
	})

	it("billed / PO'd / in Ariba / paid / outstanding follow the POs (the doc's 800 / 800 / 600 / 200 case)", () => {
		const s = summarizeAviso(
			base({
				lines: [{ qty: 1, unitPrice: 717.49 }], // total 800.00 with 11.5% IVU
				pos: [
					po(
						"P1",
						200,
						"2026-06-20",
						invoice(1, 200, { paidAt: d("2026-08-30"), paidNet: 200 }),
					),
					po(
						"P2",
						400,
						"2026-07-28",
						invoice(2, 400, { paidAt: d("2026-10-10"), paidNet: 400 }),
					),
					po("P3", 200, "2026-09-15", invoice(3, 200)),
				],
			}),
			NOW,
		)
		expect(s.money).toMatchObject({
			billed: 800,
			poed: 800,
			inAriba: 800,
			paid: 600,
			outstanding: 200,
			stillToPo: 0,
		})
		expect(s.armB).toBe("OPEN")
		expect(s.done).toBe(false)
		expect(s.pos[0].paid.source).toBe("DOCUMENT")
		expect(s.pos[0].poDate.source).toBe("DOCUMENT")
	})

	it("a short pay is owed until accepted, then it is settled", () => {
		const inv = (accepted: boolean) =>
			invoice(1, 100, {
				paidAt: d("2026-08-30"),
				paidNet: 90,
				shortAcceptedAt: accepted ? d("2026-09-01") : null,
			})
		const raw = (accepted: boolean) =>
			base({
				lines: [{ qty: 1, unitPrice: 89.69 }],
				pos: [po("P1", 100, "2026-06-20", inv(accepted))],
			})
		expect(summarizeAviso(raw(false), NOW).money.outstanding).toBe(
			10.31 - 0.31 + 0,
		)
		expect(summarizeAviso(raw(false), NOW).pos[0].shortBy).toBe(10)
		expect(summarizeAviso(raw(true), NOW).money.outstanding).toBe(0)
		expect(summarizeAviso(raw(true), NOW).pos[0].closed).toBe(true)
	})

	it("Aviso is done only when both arms are closed", () => {
		const s = summarizeAviso(base({ armBClosedAt: d("2026-10-10") }), NOW)
		expect(s.done).toBe(true)
		expect(s.armB).toBe("CLOSED")
		expect(
			summarizeAviso(
				base({ brigadePaidAt: null, armBClosedAt: d("2026-10-10") }),
				NOW,
			).done,
		).toBe(false)
	})
})

describe("reports", () => {
	const rows = [
		summarizeAviso(
			base({
				lines: [{ qty: 1, unitPrice: 717.49 }],
				pos: [
					po(
						"P1",
						400,
						"2026-06-20",
						invoice(1, 400, { paidAt: d("2026-09-22"), paidNet: 400 }),
					),
					po(
						"P2",
						400,
						"2026-07-28",
						invoice(2, 400, { loadedAt: d("2026-08-01") }),
					),
				],
			}),
			NOW,
		),
	]

	it("Arm A clock averages days by month paid", () => {
		const r = armAClock(rows)
		expect(r.average).toBe(7)
		expect(r.months).toEqual([{ month: "2026-05", count: 1, average: 7 }])
	})

	it("Waiting for PO reports days to first PO and to fully PO'd", () => {
		const [r] = waitingForPo(rows)
		expect(r.daysToFirstPo).toBe(50) // May 1 -> Jun 20
		expect(r.daysToFullyPo).toBe(88) // May 1 -> Jul 28
	})

	it("Claro aging: 90 days loaded -> paid is 30 days past a 60-day term", () => {
		const r = claroAging(rows)
		const paid = r.items.find((i) => i.invoiceNumber === "M19-1")
		expect(paid).toMatchObject({ days: 90, daysLate: 30, open: false })
		// The other is still open and long past due.
		expect(r.items.find((i) => i.invoiceNumber === "M19-2")).toMatchObject({
			open: true,
			pastDue: true,
		})
		expect(r.pastDueCount).toBe(1)
	})

	it("Open money splits billed-not-PO'd, PO'd-not-invoiced, in Ariba not paid", () => {
		const open = openMoney([
			summarizeAviso(
				base({
					lines: [{ qty: 1, unitPrice: 717.49 }],
					pos: [
						po("P1", 300, "2026-06-20", null),
						po("P2", 200, "2026-06-21", invoice(2, 200)),
					],
				}),
				NOW,
			),
		])
		expect(open).toEqual({
			billedNotPod: 300,
			podNotInvoiced: 300,
			inAribaNotPaid: 200,
		})
	})
})
