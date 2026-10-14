import { describe, expect, it } from "vitest"
import { listProgress } from "./comptroller-lists"

describe("listProgress", () => {
	it("is open while any account is unpaid", () => {
		const accounts = [
			{ paidAt: new Date() },
			{ paidAt: null },
			{ paidAt: null },
		]
		expect(listProgress({ paidAt: null }, accounts)).toEqual({
			unpaid: 2,
			accountCount: 3,
			open: true,
		})
	})

	it("is complete once the run is paid", () => {
		expect(
			listProgress({ paidAt: new Date() }, [{ paidAt: new Date() }]),
		).toMatchObject({
			unpaid: 0,
			open: false,
		})
	})

	it("treats a run with no accounts as complete", () => {
		expect(listProgress({ paidAt: null }, [])).toMatchObject({ open: false })
	})
})
