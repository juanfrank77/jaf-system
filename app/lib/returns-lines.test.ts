import { expect, it } from "vitest"
import { computeExpectedBackLines } from "./returns-lines"

it("prefills one expected-back line per material taken and skips blank ids", () => {
	expect(
		computeExpectedBackLines(
			[
				{ serviceCodeId: "a", qty: 10 },
				{ serviceCodeId: "", qty: 3 },
			],
			[{ serviceCodeId: "a", qty: 4 }],
		),
	).toEqual([{ serviceCodeId: "a", takenQty: 10, usedQty: 4, expectedBack: 6 }])
})
