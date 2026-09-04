import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		user: { findUniqueOrThrow: vi.fn() },
		jafInvoice: { findUnique: vi.fn() },
	},
	requireSession: vi.fn(),
	isComptrollerEnabled: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({
	requireSession: mocks.requireSession,
}))
vi.mock("~/lib/features.server", () => ({
	isComptrollerEnabled: mocks.isComptrollerEnabled,
}))

import { loader } from "./files.$"

function requestFor(pathname: string) {
	return new Request(`http://localhost${pathname}`)
}

describe("files loader access control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isComptrollerEnabled.mockReturnValue(true)
		mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "COMPTROLLER",
		} as any)
	})

	it("allows an enabled Comptroller to access a financeable doc", async () => {
		mocks.isComptrollerEnabled.mockReturnValue(true)
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			id: "job-1",
			status: "LC_REQUEST_GENERATED",
			supervisorId: "sup-1",
			assignedCrewIds: [],
		} as any)

		const result = await loader({
			request: requestFor("/files/jaf-invoices/job-1-jaf-invoice.pdf"),
			params: { "*": "jaf-invoices/job-1-jaf-invoice.pdf" },
		} as any)

		expect(result.status).not.toBe(403)
	})

	it("blocks a disabled Comptroller from accessing a financeable doc", async () => {
		mocks.isComptrollerEnabled.mockReturnValue(false)
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			id: "job-1",
			status: "LC_REQUEST_GENERATED",
			supervisorId: "sup-1",
			assignedCrewIds: [],
		} as any)

		const result = await loader({
			request: requestFor("/files/jaf-invoices/job-1-jaf-invoice.pdf"),
			params: { "*": "jaf-invoices/job-1-jaf-invoice.pdf" },
		} as any)

		expect(result.status).toBe(403)
	})

	it("still allows Finance access when Comptroller is disabled", async () => {
		mocks.isComptrollerEnabled.mockReturnValue(false)
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "FINANCE",
		} as any)
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			id: "job-1",
			status: "LC_REQUEST_GENERATED",
			supervisorId: "sup-1",
			assignedCrewIds: [],
		} as any)

		const result = await loader({
			request: requestFor("/files/jaf-invoices/job-1-jaf-invoice.pdf"),
			params: { "*": "jaf-invoices/job-1-jaf-invoice.pdf" },
		} as any)

		expect(result.status).not.toBe(403)
	})

	it("still allows Admin access when Comptroller is disabled", async () => {
		mocks.isComptrollerEnabled.mockReturnValue(false)
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "ADMIN",
		} as any)

		const result = await loader({
			request: requestFor("/files/jaf-invoices/job-1-jaf-invoice.pdf"),
			params: { "*": "jaf-invoices/job-1-jaf-invoice.pdf" },
		} as any)

		expect(result.status).not.toBe(403)
	})
})
