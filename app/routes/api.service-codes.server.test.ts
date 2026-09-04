import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: { serviceCode: { count: vi.fn() } },
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/service-codes.server", () => ({ searchServiceCodes: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { searchServiceCodes } from "~/lib/service-codes.server"
import { loader } from "./api.service-codes"

describe("GET /api/service-codes", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns every match with account, unit and price — never picks one", async () => {
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
		vi.mocked(db.serviceCode.count).mockResolvedValue(934)
		vi.mocked(searchServiceCodes).mockResolvedValue([
			{
				id: "c1",
				claroCode: "34006301",
				name: "TRANSFER ATTCH DE POSTESMC",
				accountCode: "610",
				unit: "EA",
				unitPrice: "42.3430",
			},
			{
				id: "c2",
				claroCode: "34006498",
				name: "TRANSFER ATTCH DE POSTESMC",
				accountCode: "615",
				unit: "EA",
				unitPrice: "42.3430",
			},
		] as any)
		const res = await loader({
			request: new Request("http://localhost/api/service-codes?q=transfer"),
			params: {},
		} as any)
		const body = await (res as Response).json()
		expect(searchServiceCodes).toHaveBeenCalledWith("transfer", 25)
		expect(body.total).toBe(934)
		expect(body.results).toEqual([
			{
				id: "c1",
				claroCode: "34006301",
				name: "TRANSFER ATTCH DE POSTESMC",
				accountCode: "610",
				unit: "EA",
				unitPrice: 42.343,
			},
			{
				id: "c2",
				claroCode: "34006498",
				name: "TRANSFER ATTCH DE POSTESMC",
				accountCode: "615",
				unit: "EA",
				unitPrice: 42.343,
			},
		])
	})

	it("returns no results for an empty query", async () => {
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
		vi.mocked(db.serviceCode.count).mockResolvedValue(934)
		vi.mocked(searchServiceCodes).mockResolvedValue([])
		const res = await loader({
			request: new Request("http://localhost/api/service-codes"),
			params: {},
		} as any)
		expect((await (res as Response).json()).results).toEqual([])
	})
})
