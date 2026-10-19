import fs from "node:fs"
import path from "node:path"
import { redirect } from "react-router"
import { extractText, getDocumentProxy } from "unpdf"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: { jafInvoice: { findUnique: vi.fn() } },
	requireRole: vi.fn(),
	getIvuRate: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: mocks.getIvuRate,
}))

import { loader } from "./_app.finance.verify.$id.invoice"

type Role = "FINANCE" | "ADMIN" | "SUPERVISOR" | "WAREHOUSE" | "CREW"

function as(role: Role) {
	mocks.requireRole.mockImplementation(async (_req, roles: string[]) => {
		if (!roles.includes(role)) throw redirect("/dashboard")
		return { user: { id: `${role}-1`, role, name: role }, session: {} }
	})
}

const SENT_AT = new Date("2026-10-01T15:00:00Z")

const sentDoc = (overrides: Record<string, unknown> = {}) => ({
	id: "job-1",
	controlNumber: "MAINT-261001-001",
	avisoNumber: "739",
	jobType: "MAINTENANCE",
	jobAddressActual: null,
	jobAddressEstimated: "Calle 1, Yabucoa",
	startedAt: new Date("2026-09-30T13:00:00Z"),
	fieldSubmittedAt: null,
	jafInvoiceGeneratedAt: SENT_AT,
	jafInvoiceLines: [
		{
			serviceCodeId: "svc-1",
			claroCode: "34006301",
			accountCode: "610",
			name: "TRANSFER",
			qty: 3,
			unit: "EA",
			unitPrice: 41.25,
			lineAmount: 123.75,
		},
	],
	brigade: { name: "JESUS MARTINEZ" },
	completedBy: { name: "Sara Supervisor" },
	supervisor: { name: "Sara Supervisor" },
	...overrides,
})

const load = () =>
	loader({
		request: new Request("http://localhost/finance/verify/job-1/invoice.pdf"),
		params: { id: "job-1" },
	} as any).catch((r: unknown) => r) as Promise<Response>

async function textOf(res: Response): Promise<string> {
	const buf = new Uint8Array(await res.arrayBuffer())
	const doc = await getDocumentProxy(buf)
	const { text } = await extractText(doc, { mergePages: true })
	return text
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.getIvuRate.mockResolvedValue(0.115)
	mocks.db.jafInvoice.findUnique.mockResolvedValue(sentDoc())
})

describe("GET /finance/verify/:id/invoice.pdf — the priced JAF invoice", () => {
	it.each(["FINANCE", "ADMIN"] as const)(
		"%s gets a priced PDF built from the locked lines",
		async (role) => {
			as(role)
			const res = await load()
			expect(res.status).toBe(200)
			expect(res.headers.get("Content-Type")).toBe("application/pdf")
			const text = await textOf(res.clone())
			expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
			expect(text).toContain("JAF INVOICE")
			expect(text).toContain("34006301")
			expect(text).toContain("$123.75")
			expect(text).toContain("M2026-739")
		},
	)

	it.each(["SUPERVISOR", "WAREHOUSE", "CREW"] as const)(
		"%s is refused",
		async (role) => {
			as(role)
			const res = await load()
			expect(res.status).toBe(302)
			expect(mocks.requireRole).toHaveBeenCalledWith(expect.any(Request), [
				"FINANCE",
				"ADMIN",
			])
			expect(mocks.db.jafInvoice.findUnique).not.toHaveBeenCalled()
		},
	)

	it("404s for a job whose packet was never sent", async () => {
		as("FINANCE")
		mocks.db.jafInvoice.findUnique.mockResolvedValue(
			sentDoc({ jafInvoiceGeneratedAt: null }),
		)
		const res = await load()
		expect(res.status).toBe(404)
	})

	it("404s for an unknown job", async () => {
		as("FINANCE")
		mocks.db.jafInvoice.findUnique.mockResolvedValue(null)
		expect((await load()).status).toBe(404)
	})

	it("dates the invoice at the first send, the same on every download", async () => {
		as("FINANCE")
		vi.useFakeTimers({ toFake: ["Date"] })
		try {
			vi.setSystemTime(new Date("2026-12-25T12:00:00Z"))
			const first = await textOf(await load())
			vi.setSystemTime(new Date("2027-02-01T12:00:00Z"))
			const second = await textOf(await load())
			expect(first).toContain("10/1/2026")
			expect(first).not.toContain("12/25/2026")
			expect(second).toContain("10/1/2026")
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("the priced invoice is never reachable by a supervisor", () => {
	const routesDir = path.resolve(import.meta.dirname)
	const sources = fs
		.readdirSync(routesDir)
		.filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
		.map((f) => ({
			file: f,
			src: fs.readFileSync(path.join(routesDir, f), "utf8"),
		}))

	it("only the Finance invoice route renders it", () => {
		const renderers = sources
			.filter((s) => s.src.includes("pdf/jaf-invoice.server"))
			.map((s) => s.file)
		expect(renderers).toEqual(["_app.finance.verify.$id.invoice.tsx"])
	})

	it("only Finance and Admin pages link it", () => {
		const linkers = sources
			.filter((s) => s.src.includes("/invoice.pdf"))
			.map((s) => s.file)
			.sort()
		expect(linkers).toEqual([
			"_app.admin.docs.$id.tsx",
			"_app.finance.verify.$id.tsx",
		])
	})

	it("is registered under finance/", () => {
		const routes = fs.readFileSync(
			path.resolve(routesDir, "../routes.ts"),
			"utf8",
		)
		expect(routes).toMatch(
			/route\(\s*"finance\/verify\/:id\/invoice\.pdf",\s*"routes\/_app\.finance\.verify\.\$id\.invoice\.tsx",?\s*\)/,
		)
	})
})
