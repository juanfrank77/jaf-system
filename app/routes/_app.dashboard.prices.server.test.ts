import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"

// Integration test against the real (test) Postgres DB. A price-blind role's
// dashboard payload carries no prices, amounts or signatures (spec anti-goal
// "prices leaking into supervisor-visible payloads"); Admin still gets them.

vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))

import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const tag = `dpr${Date.now()}`
const HOOK_TIMEOUT = 60_000

/** Every price, money or signature key that must never reach a SUPERVISOR. */
const FORBIDDEN_KEYS = [
	"unitPrice",
	"lineAmount",
	"jafInvoiceLines",
	"jafInvoiceLineTotal",
	"avisoLines",
	"avisoLineTotal",
	"advanceAmount",
	"finalPaymentAmount",
	"contractorShareLines",
	"grossPayable",
	"retentionAmount",
	"netPayable",
	"completionSignature",
]

async function runLoaderAs(userId: string, searchParams?: string) {
	vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as any)
	return loader({
		request: new Request(
			`http://localhost/dashboard${searchParams ? `?${searchParams}` : ""}`,
		),
		params: {},
	} as any)
}

/** Every object key anywhere in the payload. */
function keysIn(value: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const v of value) keysIn(v, out)
	else if (value && typeof value === "object" && !(value instanceof Date))
		for (const [k, v] of Object.entries(value)) {
			out.add(k)
			keysIn(v, out)
		}
	return out
}

const LINES = [
	{
		serviceCodeId: "s1",
		claroCode: "34006301",
		name: "TRANSFER",
		qty: 2,
		unitPrice: 42.343,
		lineAmount: 84.69,
	},
]

describe("dashboard payload: no prices for a SUPERVISOR", () => {
	let supId: string
	let adminId: string

	beforeAll(async () => {
		supId = (
			await db.user.create({
				data: {
					email: `dash-pr-${tag}@x.com`,
					name: "PrSup",
					role: "SUPERVISOR",
					supervisorAreas: [],
				},
			})
		).id
		adminId = (
			await db.user.create({
				data: {
					email: `dash-pr-admin-${tag}@x.com`,
					name: "PrAdm",
					role: "ADMIN",
				},
			})
		).id
		await db.jafInvoice.create({
			data: {
				controlNumber: `DASH-PR-priced-${tag}`,
				jobType: "Install",
				jobAddressEstimated: "123 Main",
				estimatedMaterials: [],
				supervisorId: supId,
				status: "SUPERVISOR_APPROVED",
				supervisorApprovedAt: new Date(),
				jafInvoiceGeneratedAt: new Date(),
				jafInvoiceLines: LINES,
				jafInvoiceLineTotal: 84.69,
				avisoLines: LINES,
				avisoLineTotal: 84.69,
				grossPayable: 55,
				retentionAmount: 5.5,
				netPayable: 49.5,
				contractorShareLines: LINES,
				completionSignature: "data:image/png;base64,AAAA",
			},
		})
	}, HOOK_TIMEOUT)

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: tag } },
		})
		await db.user.deleteMany({ where: { id: { in: [supId, adminId] } } })
	}, HOOK_TIMEOUT)

	it(
		"the supervisor's home, sidebar queues and filters ship none of them",
		async () => {
			for (const q of [
				undefined,
				"stage=all",
				"stage=invoice",
				"status=SUPERVISOR_APPROVED",
			]) {
				const data = await runLoaderAs(supId, q)
				expect(data.docs.length).toBeGreaterThan(0)
				const keys = keysIn(data)
				for (const k of FORBIDDEN_KEYS)
					expect(keys.has(k), `${q}: ${k}`).toBe(false)
				expect(JSON.stringify(data)).not.toContain("data:image")
			}
		},
		HOOK_TIMEOUT,
	)

	it(
		"an Admin still gets the money columns",
		async () => {
			const data = await runLoaderAs(adminId)
			const doc = data.docs.find((d) => d.controlNumber.endsWith(tag)) as
				| Record<string, unknown>
				| undefined
			expect(doc).toBeDefined()
			expect(doc?.jafInvoiceLines).toEqual(LINES)
			expect(Number(doc?.jafInvoiceLineTotal)).toBe(84.69)
			expect(Number(doc?.netPayable)).toBe(49.5)
		},
		HOOK_TIMEOUT,
	)
})

describe("My open jobs is not cut off at 50", () => {
	let supId: string

	beforeAll(async () => {
		supId = (
			await db.user.create({
				data: {
					email: `dash-open-${tag}@x.com`,
					name: "OpenSup",
					role: "SUPERVISOR",
					supervisorAreas: [],
				},
			})
		).id
		await db.jafInvoice.createMany({
			data: Array.from({ length: 60 }, (_, i) => ({
				controlNumber: `DASH-OPEN-${i}-${tag}`,
				jobType: "Install",
				jobAddressEstimated: "123 Main",
				estimatedMaterials: [],
				supervisorId: supId,
				status: "CREATED" as const,
			})),
		})
	}, HOOK_TIMEOUT)

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: tag } },
		})
		await db.user.delete({ where: { id: supId } })
	}, HOOK_TIMEOUT)

	it(
		"?stage=open lists all 60 open jobs",
		async () => {
			const data = await runLoaderAs(supId, "stage=open")
			expect(data.docs).toHaveLength(60)
		},
		HOOK_TIMEOUT,
	)
})
