import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		user: { findUniqueOrThrow: vi.fn() },
		jafInvoice: { findUnique: vi.fn() },
		installCompletion: { findUnique: vi.fn(), findFirst: vi.fn() },
	},
	requireSession: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({
	requireSession: mocks.requireSession,
}))

import { loader } from "./files.$"

function requestFor(pathname: string) {
	return new Request(`http://localhost${pathname}`)
}

describe("files loader access control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "COMPTROLLER",
		} as any)
	})

	it("allows a Comptroller to access a financeable doc", async () => {
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

	it("still allows Finance access", async () => {
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

	it("still allows Admin access", async () => {
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

describe("files loader — payroll run evidence (Review Focus)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } })
	})

	// The file itself does not exist, so an authorised request falls through to
	// the 404 at the end of the loader. Asserting "not 403" is what separates
	// "authorised" from "blocked", which is the only thing under test here.
	function loadEvidence() {
		return loader({
			request: requestFor("/files/payroll-runs/run-1-evidence.pdf"),
			params: { "*": "payroll-runs/run-1-evidence.pdf" },
		} as any)
	}

	it("allows a Comptroller to read payroll run evidence", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "COMPTROLLER",
		} as any)

		const result = await loadEvidence()

		expect(result.status).not.toBe(403)
	})

	it("still allows Finance access", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "FINANCE",
		} as any)

		const result = await loadEvidence()

		expect(result.status).not.toBe(403)
	})

	it("still allows Admin access", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "ADMIN",
		} as any)

		const result = await loadEvidence()

		expect(result.status).not.toBe(403)
	})

	it("blocks a role with no finance access ", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "user-1",
			role: "SUPERVISOR",
		} as any)

		const result = await loadEvidence()

		expect(result.status).toBe(403)
	})
})

describe("files loader — install completion files", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireSession.mockResolvedValue({ user: { id: "inst-1" } })
	})

	it("allows the installer who owns the completion to fetch its PDF", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "inst-1",
			role: "INSTALLER",
		} as any)
		mocks.db.installCompletion.findUnique.mockResolvedValue({
			id: "comp-1",
			installerId: "inst-1",
		} as any)

		const result = await loader({
			request: requestFor("/files/completions/comp-1.pdf"),
			params: { "*": "completions/comp-1.pdf" },
		} as any)

		expect(result.status).not.toBe(403)
	})

	it("blocks an installer who does not own the completion", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "inst-2",
			role: "INSTALLER",
		} as any)
		mocks.db.installCompletion.findUnique.mockResolvedValue({
			id: "comp-1",
			installerId: "inst-1",
		} as any)

		const result = await loader({
			request: requestFor("/files/completions/comp-1.pdf"),
			params: { "*": "completions/comp-1.pdf" },
		} as any)

		expect(result.status).toBe(403)
	})

	it("allows an installer supervisor to fetch a completion photo by stored path", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "sup-1",
			role: "INSTALLER_SUPERVISOR",
		} as any)
		mocks.db.installCompletion.findFirst.mockResolvedValue({
			id: "comp-1",
			installerId: "inst-1",
		} as any)

		const result = await loader({
			request: requestFor("/files/completions/photos/123-form.jpg"),
			params: { "*": "completions/photos/123-form.jpg" },
		} as any)

		expect(result.status).not.toBe(403)
	})

	it("blocks a completion photo with no matching InstallCompletion record", async () => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "sup-1",
			role: "INSTALLER_SUPERVISOR",
		} as any)
		mocks.db.installCompletion.findFirst.mockResolvedValue(null)

		const result = await loader({
			request: requestFor("/files/completions/photos/unknown.jpg"),
			params: { "*": "completions/photos/unknown.jpg" },
		} as any)

		expect(result.status).toBe(403)
	})
})
