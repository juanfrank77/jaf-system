import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: { serviceCode: { count: vi.fn() }, user: { findUnique: vi.fn() } },
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	searchServiceCodes: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { searchServiceCodes } from "~/lib/service-codes.server"
import { loader } from "./api.service-codes"

describe("GET /api/service-codes", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			role: "FINANCE",
		} as any)
	})

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
	const hit = {
		id: "c1",
		claroCode: "34006301",
		name: "TRANSFER ATTCH DE POSTESMC",
		accountCode: "610",
		unit: "EA",
		unitPrice: "42.3430",
	}

	it("refuses a CREW session (crew accounts no longer sign in)", async () => {
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({ role: "CREW" } as any)
		const res = await loader({
			request: new Request("http://localhost/api/service-codes?q=t"),
			params: {},
		} as any)
		expect((res as Response).status).toBe(403)
		expect(searchServiceCodes).not.toHaveBeenCalled()
	})

	it.each(["WAREHOUSE", "SUPERVISOR"])(
		"omits unitPrice for %s",
		async (role) => {
			vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
			vi.mocked(db.user.findUnique).mockResolvedValue({ role } as any)
			vi.mocked(db.serviceCode.count).mockResolvedValue(1)
			vi.mocked(searchServiceCodes).mockResolvedValue([hit] as any)
			const res = await loader({
				request: new Request("http://localhost/api/service-codes?q=t"),
				params: {},
			} as any)
			const body = await (res as Response).json()
			expect(body.results).toHaveLength(1)
			expect("unitPrice" in body.results[0]).toBe(false)
		},
	)

	it("omits unitPrice when the viewer cannot be found (fails closed)", async () => {
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
		vi.mocked(db.user.findUnique).mockResolvedValue(null)
		vi.mocked(db.serviceCode.count).mockResolvedValue(1)
		vi.mocked(searchServiceCodes).mockResolvedValue([hit] as any)
		const res = await loader({
			request: new Request("http://localhost/api/service-codes?q=t"),
			params: {},
		} as any)
		const body = await (res as Response).json()
		expect("unitPrice" in body.results[0]).toBe(false)
	})
})
