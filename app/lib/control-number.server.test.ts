import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the db module before importing the function
vi.mock("./db.server", () => ({
	db: {
		jafInvoice: {
			count: vi.fn(),
		},
	},
}))

import { generateControlNumber } from "./control-number.server"
import { db } from "./db.server"

describe("generateControlNumber", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns MAINT-YYMMDD-001 for first doc of the day", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		const result = await generateControlNumber("2026-06-15")
		expect(result).toBe("MAINT-260615-001")
	})

  it("increments sequence when docs already exist today", async () => {
    vi.mocked(db.jafInvoice.count).mockResolvedValue(5)
    const result = await generateControlNumber("2026-06-15")
    expect(result).toBe("MAINT-260615-006")
  })

	it("pads sequence to 3 digits", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(99)
		const result = await generateControlNumber("2026-06-15")
		expect(result).toBe("MAINT-260615-100")
	})
})
