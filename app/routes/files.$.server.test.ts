import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
		jafInvoice: { findUnique: vi.fn() },
		installCompletion: { findUnique: vi.fn(), findFirst: vi.fn() },
		sentReport: { findUnique: vi.fn() },
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

describe("files loader — job photos and blueprints for supervisors", () => {
	let dir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		dir = await mkdtemp(path.join(tmpdir(), "files-test-"))
		process.env.UPLOAD_DIR = dir
		for (const rel of [
			"photos/job-1/1-0-a.jpg",
			"blueprints/job-1/1-0-plan.pdf",
		]) {
			await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
			await writeFile(path.join(dir, rel), "bytes")
		}
		mocks.requireSession.mockResolvedValue({ user: { id: "sup-2" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "sup-2",
			role: "SUPERVISOR",
		} as any)
		mocks.db.user.findUnique.mockResolvedValue({
			supervisorAreas: ["CENTRAL"],
		} as any)
		mocks.db.jafInvoice.findUnique.mockImplementation((async (args: any) =>
			args.where.id === "job-1"
				? {
						status: "SIGNED",
						supervisorId: "sup-1",
						assignedCrewIds: ["crew-1"],
						brigade: { area: "CENTRAL" },
					}
				: null) as any)
	})

	const get = (rel: string) =>
		loader({
			request: requestFor(`/files/${rel}`),
			params: { "*": rel },
		} as any) as Promise<Response>

	it("serves a job photo to a supervisor covering the job's area", async () => {
		const res = await get("photos/job-1/1-0-a.jpg")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("image/jpeg")
		expect(mocks.db.jafInvoice.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "job-1" } }),
		)
	})

	it("serves a job blueprint to a supervisor covering the job's area", async () => {
		const res = await get("blueprints/job-1/1-0-plan.pdf")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
		expect(mocks.db.jafInvoice.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "job-1" } }),
		)
	})

	it("refuses a supervisor outside the job's area", async () => {
		mocks.db.user.findUnique.mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		expect((await get("photos/job-1/1-0-a.jpg")).status).toBe(403)
		expect((await get("blueprints/job-1/1-0-plan.pdf")).status).toBe(403)
	})

	it("still serves the job's own supervisor without an area match", async () => {
		mocks.requireSession.mockResolvedValue({ user: { id: "sup-1" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "sup-1",
			role: "SUPERVISOR",
		} as any)
		mocks.db.user.findUnique.mockResolvedValue({ supervisorAreas: [] } as any)
		expect((await get("blueprints/job-1/1-0-plan.pdf")).status).toBe(200)
	})

	it("refuses every CREW session, assigned or not, and keeps Finance's pre-approval rule", async () => {
		for (const id of ["crew-1", "crew-9"]) {
			mocks.db.user.findUniqueOrThrow.mockResolvedValue({
				id,
				role: "CREW",
			} as any)
			expect((await get("blueprints/job-1/1-0-plan.pdf")).status).toBe(403)
			expect((await get("photos/job-1/1-0-a.jpg")).status).toBe(403)
		}
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "fin-1",
			role: "FINANCE",
		} as any)
		expect((await get("photos/job-1/1-0-a.jpg")).status).toBe(403)
	})

	it("refuses a blueprint of a job that does not exist", async () => {
		expect((await get("blueprints/job-404/1-0-plan.pdf")).status).toBe(403)
	})
})

describe("files loader — legacy priced JAF invoices (jaf-invoices/)", () => {
	let dir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		dir = await mkdtemp(path.join(tmpdir(), "files-test-"))
		process.env.UPLOAD_DIR = dir
		await mkdir(path.join(dir, "jaf-invoices"), { recursive: true })
		await writeFile(
			path.join(dir, "jaf-invoices/job-1-jaf-invoice.pdf"),
			"%PDF",
		)
		await mkdir(path.join(dir, "packets"), { recursive: true })
		await writeFile(path.join(dir, "packets/job-1-packet-1-ab.pdf"), "%PDF")
		// The job's own supervisor, a job in a status every role may read.
		mocks.db.user.findUnique.mockResolvedValue({ supervisorAreas: [] } as any)
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			status: "SUPERVISOR_APPROVED",
			supervisorId: "u-1",
			brigade: { area: "CENTRAL" },
		} as any)
	})

	const as = (role: string) => {
		mocks.requireSession.mockResolvedValue({ user: { id: "u-1" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "u-1",
			role,
		} as any)
	}
	const get = (rel: string) =>
		loader({
			request: requestFor(`/files/${rel}`),
			params: { "*": rel },
		} as any) as Promise<Response>

	it.each(["SUPERVISOR", "WAREHOUSE", "CREW", "INSTALLER"])(
		"refuses %s, even the job's own supervisor",
		async (role) => {
			as(role)
			expect((await get("jaf-invoices/job-1-jaf-invoice.pdf")).status).toBe(403)
		},
	)

	it("refuses a supervisor who reaches the folder through ../", async () => {
		as("SUPERVISOR")
		expect(
			(await get("packets/../jaf-invoices/job-1-jaf-invoice.pdf")).status,
		).toBe(403)
	})

	it.each(["FINANCE", "ADMIN", "COMPTROLLER"])("serves %s", async (role) => {
		as(role)
		expect((await get("jaf-invoices/job-1-jaf-invoice.pdf")).status).toBe(200)
	})

	it("still serves the job's supervisor the price-free packet", async () => {
		as("SUPERVISOR")
		expect((await get("packets/job-1-packet-1-ab.pdf")).status).toBe(200)
	})
})

describe("files loader — Finance and Comptroller never see the Prefield or blueprints", () => {
	let dir: string
	const rels = [
		"blueprints/job-1/1-0-plan.pdf",
		"packets/job-1-prefield-123.pdf",
		"packets/job-1-work-order-123.pdf",
		"aviso-docs/job-1-aviso.pdf",
		"precert/job-1-v2.pdf",
		"photos/job-1/1-0-a.jpg",
	]

	beforeEach(async () => {
		vi.clearAllMocks()
		dir = await mkdtemp(path.join(tmpdir(), "files-test-"))
		process.env.UPLOAD_DIR = dir
		for (const rel of rels) {
			await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
			await writeFile(path.join(dir, rel), "bytes")
		}
		mocks.requireSession.mockResolvedValue({ user: { id: "u-1" } })
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			status: "SUPERVISOR_APPROVED",
			supervisorId: "sup-1",
			brigade: { area: "CENTRAL" },
		} as any)
	})

	const as = (role: string, rel: string) => {
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "u-1",
			role,
		} as any)
		return loader({
			request: requestFor(`/files/${rel}`),
			params: { "*": rel },
		} as any) as Promise<Response>
	}

	for (const role of ["FINANCE", "COMPTROLLER"]) {
		it(`denies ${role} the blueprints and the Prefield PDF`, async () => {
			expect((await as(role, rels[0])).status).toBe(403)
			expect((await as(role, rels[1])).status).toBe(403)
		})

		it(`still lets ${role} open the packet PDF, Aviso, Pre-cert and photos`, async () => {
			for (const rel of rels.slice(2))
				expect((await as(role, rel)).status).toBe(200)
		})
	}

	it("keeps Admin and Supervisor on every file", async () => {
		mocks.db.user.findUnique.mockResolvedValue({ supervisorAreas: [] } as any)
		for (const rel of rels) {
			expect((await as("ADMIN", rel)).status).toBe(200)
		}
		mocks.db.jafInvoice.findUnique.mockResolvedValue({
			status: "SUPERVISOR_APPROVED",
			supervisorId: "u-1",
			brigade: { area: "CENTRAL" },
		} as any)
		for (const rel of rels) {
			expect((await as("SUPERVISOR", rel)).status).toBe(200)
		}
	})
})

describe("files loader — Carmen's installer money files", () => {
	const as = (role: string, id = "user-1") => {
		mocks.requireSession.mockResolvedValue({ user: { id } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id, role } as any)
	}
	const get = (p: string) =>
		loader({ request: requestFor(`/files/${p}`), params: { "*": p } } as any)

	beforeEach(() => vi.clearAllMocks())

	it("lets Carmen open a warranty photo, but not a completion PDF or an unknown file", async () => {
		as("COMPTROLLER")
		mocks.db.installCompletion.findFirst.mockResolvedValue({ id: "c1" })
		expect((await get("completions/photo-1.jpg")).status).not.toBe(403)
		mocks.db.installCompletion.findFirst.mockResolvedValue(null)
		expect((await get("completions/c1.pdf")).status).toBe(403)
	})

	it("serves EWIT invoices, installer batches and PBCC statements to Carmen and Admin only", async () => {
		for (const folder of ["ewit-invoices", "ewit-batches", "pbcc-statements"]) {
			as("COMPTROLLER")
			expect((await get(`${folder}/x.pdf`)).status).not.toBe(403)
			as("ADMIN")
			expect((await get(`${folder}/x.pdf`)).status).not.toBe(403)
			for (const role of ["FINANCE", "SUPERVISOR", "INSTALLER", "WAREHOUSE"]) {
				as(role)
				expect((await get(`${folder}/x.pdf`)).status).toBe(403)
			}
		}
	})

	it("serves a report only to the person who sent it and the one it went to", async () => {
		mocks.db.sentReport.findUnique.mockResolvedValue({
			fromId: "carmen",
			toId: "monica",
		})
		as("COMPTROLLER", "carmen")
		expect((await get("reports/r1.pdf")).status).not.toBe(403)
		as("ADMIN", "monica")
		expect((await get("reports/r1.pdf")).status).not.toBe(403)
		as("ADMIN", "someone-else")
		expect((await get("reports/r1.pdf")).status).toBe(403)
		mocks.db.sentReport.findUnique.mockResolvedValue(null)
		as("ADMIN", "monica")
		expect((await get("reports/r2.pdf")).status).toBe(403)
	})
})
