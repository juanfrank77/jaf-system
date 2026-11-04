import { describe, expect, it } from "vitest"
import { splitCrewPayment } from "~/lib/payroll-run.server"

const svc = (serviceCodeId: string, qty = 1) => ({
	serviceCodeId,
	claroCode: serviceCodeId,
	accountCode: null,
	name: serviceCodeId,
	qty,
})
const paymentLine = (serviceCodeId: string, jafPrice: number) => ({
	serviceCodeId,
	claroCode: serviceCodeId,
	name: serviceCodeId,
	qty: 1,
	jafPrice,
	sharePercent: 0.65,
})
const account = (id: string) => ({
	id,
	code: id,
	label: id.toUpperCase(),
	brigadeCode: id,
})

describe("splitCrewPayment", () => {
	const crews = [
		{ brigadeId: "b1", lines: [svc("a")], account: account("025") },
		{ brigadeId: "b2", lines: [svc("b")], account: account("011") },
	]

	it("pays each brigade for its own lines and adds them up for the job", () => {
		const p = splitCrewPayment(
			[paymentLine("a", 100), paymentLine("b", 50)],
			crews,
		)
		expect(
			p.contractorShareLines.map((l) => [
				l.serviceCodeId,
				(l as unknown as { account: { code: string } }).account.code,
			]),
		).toEqual([
			["a", "025"],
			["b", "011"],
		])
		expect(p.grossPayable).toBe(150)
	})

	it("gives a line no card holds to the first crew, so nothing goes unpaid", () => {
		const p = splitCrewPayment([paymentLine("corrected", 40)], crews)
		expect(
			(p.contractorShareLines[0] as unknown as { account: { code: string } })
				.account.code,
		).toBe("025")
	})
})
