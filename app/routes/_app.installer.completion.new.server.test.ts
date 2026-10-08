import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	submitCompletion: vi.fn(),
	db: {
		limitTable: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		serialLocation: { findMany: vi.fn() },
	},
	getSerializedCodes: vi.fn(),
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/completion-submit.server", () => ({
	submitCompletion: mocks.submitCompletion,
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/service-codes.server", async () => {
	const actual = await vi.importActual<
		typeof import("~/lib/service-codes.server")
	>("~/lib/service-codes.server")
	return {
		getSerializedCodes: mocks.getSerializedCodes,
		serviceCodesForRole: actual.serviceCodesForRole,
	}
})

import { action, loader } from "./_app.installer.completion.new"

function offlineRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/installer/completion/new", {
		method: "POST",
		body: form,
		headers: { "X-Offline-Sync": "true" },
	})
}

describe("POST /installer/completion/new", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.db.limitTable.findMany.mockResolvedValue([])
	})

	it("returns 409 with a conflict when the installer's van is inactive (offline sync)", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: false },
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = (await action({
			request: req,
			params: {},
			context: {},
		} as never)) as { init: { status: number } | null; data: unknown }
		expect(res.init?.status).toBe(409)
		expect(mocks.submitCompletion).not.toHaveBeenCalled()
	})

	it("submits and returns the result JSON when offline-synced and the van is active", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: true },
		})
		mocks.submitCompletion.mockResolvedValue({
			completionId: "c1",
			paymentRequestId: "pr1",
			status: "READY",
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = (await action({
			request: req,
			params: {},
			context: {},
		} as never)) as { init: { status: number } | null; data: unknown }
		expect(res.init?.status).toBe(200)
		expect(res.data).toEqual({
			ok: true,
			completionId: "c1",
			paymentRequestId: "pr1",
			status: "READY",
		})
	})

	it("returns a validation error instead of crashing when claroOrderNo is missing", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: true },
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = await action({ request: req, params: {}, context: {} } as never)
		expect(res).toMatchObject({
			data: {
				validationError: "installer.completion.errors.order_no_required",
			},
			init: { status: 422 },
		})
		expect(mocks.submitCompletion).not.toHaveBeenCalled()
	})

	it("returns a validation error instead of crashing when address is missing", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: true },
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = await action({ request: req, params: {}, context: {} } as never)
		expect(res).toMatchObject({
			data: { validationError: "installer.completion.errors.address_required" },
			init: { status: 422 },
		})
		expect(mocks.submitCompletion).not.toHaveBeenCalled()
	})

	it("ignores a client-supplied formPhotoPath instead of trusting it as a real upload", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: true },
		})
		mocks.submitCompletion.mockResolvedValue({
			completionId: "c1",
			paymentRequestId: "pr1",
			status: "READY",
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
			formPhotoPath:
				"/tmp/jaf/uploads/completions/photos/someone-elses-photo.jpg",
		})
		await action({ request: req, params: {}, context: {} } as never)
		expect(mocks.submitCompletion).toHaveBeenCalledWith(
			expect.objectContaining({
				formPhotoPath: undefined,
			}),
			expect.anything(),
		)
	})

	describe("accessories hardening", () => {
		async function post(extra: Record<string, string>) {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "inst-1" },
				profile: { id: "p1" },
				van: { id: "van-1", active: true },
			})
			mocks.submitCompletion.mockResolvedValue({
				completionId: "c1",
				paymentRequestId: "pr1",
				status: "READY",
			})
			return action({
				request: offlineRequest({
					idempotencyKey: "k1",
					claroOrderNo: "430920",
					address: "a",
					serialUnreadable: "true",
					...extra,
				}),
				params: {},
				context: {},
			} as never)
		}
		// These requests are offline replays, so the refusal is a 422.
		const invalid = {
			data: {
				validationError: "installer.completion.errors.invalid_accessories",
			},
			init: { status: 422 },
		}

		it("rejects malformed JSON instead of crashing", async () => {
			expect(await post({ accessories: "{bad" })).toMatchObject(invalid)
			expect(mocks.submitCompletion).not.toHaveBeenCalled()
		})

		it.each([
			["not an array", '{"a":1}'],
			["missing code", '[{"qty":1}]'],
			["negative qty", '[{"serviceCodeId":"sc-1","qty":-1}]'],
			["fractional qty", '[{"serviceCodeId":"sc-1","qty":1.5}]'],
			["string qty", '[{"serviceCodeId":"sc-1","qty":"3"}]'],
			[
				"duplicate code",
				'[{"serviceCodeId":"sc-1","qty":1},{"serviceCodeId":"sc-1","qty":2}]',
			],
		])("rejects %s", async (_n, accessories) => {
			expect(await post({ accessories })).toMatchObject(invalid)
			expect(mocks.submitCompletion).not.toHaveBeenCalled()
		})

		it("ignores a forged prefilledQty and recomputes it from the limit table", async () => {
			mocks.db.limitTable.findMany.mockResolvedValue([
				{ bracketFt: 100, serviceCodeId: "sc-1", qty: 4 },
				{ bracketFt: 200, serviceCodeId: "sc-1", qty: 9 },
			])
			// Installer raised 4 -> 6 but claims the prefill was already 6.
			await post({
				dropFt: "80",
				accessories: JSON.stringify([
					{ serviceCodeId: "sc-1", prefilledQty: 6, qty: 6 },
				]),
			})
			expect(mocks.submitCompletion.mock.calls[0][0].accessories).toEqual([
				{ serviceCodeId: "sc-1", prefilledQty: 4, qty: 6 },
			])
		})

		it("keeps a prefilled line the client dropped, as qty 0", async () => {
			mocks.db.limitTable.findMany.mockResolvedValue([
				{ bracketFt: 100, serviceCodeId: "sc-1", qty: 4 },
				{ bracketFt: 100, serviceCodeId: "sc-2", qty: 2 },
			])
			await post({
				dropFt: "100",
				accessories: JSON.stringify([{ serviceCodeId: "sc-1", qty: 4 }]),
			})
			expect(mocks.submitCompletion.mock.calls[0][0].accessories).toEqual([
				{ serviceCodeId: "sc-1", prefilledQty: 4, qty: 4 },
				{ serviceCodeId: "sc-2", prefilledQty: 2, qty: 0 },
			])
		})

		it("treats a code outside the bracket as prefilled 0", async () => {
			await post({
				dropFt: "100",
				accessories: JSON.stringify([{ serviceCodeId: "sc-9", qty: 2 }]),
			})
			expect(mocks.submitCompletion.mock.calls[0][0].accessories).toEqual([
				{ serviceCodeId: "sc-9", prefilledQty: 0, qty: 2 },
			])
		})
	})

	describe("address edit log", () => {
		async function submitWith(extra: Record<string, string>) {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "inst-1" },
				profile: { id: "p1" },
				van: { id: "van-1", active: true },
			})
			mocks.submitCompletion.mockResolvedValue({
				completionId: "c1",
				paymentRequestId: "pr1",
				status: "READY",
			})
			await action({
				request: offlineRequest({
					idempotencyKey: "k1",
					claroOrderNo: "430920",
					address: "Calle Sol 12",
					serialUnreadable: "true",
					accessories: "[]",
					...extra,
				}),
				params: {},
				context: {},
			} as never)
			return mocks.submitCompletion.mock.calls[0][0]
		}

		it("logs who and when, stamped by the server, when the address changed", async () => {
			const input = await submitWith({ addressOriginal: "Calle Sol 21" })
			expect(input.address).toBe("Calle Sol 12")
			expect(input.addressEditLog).toHaveLength(1)
			expect(input.addressEditLog[0]).toMatchObject({
				original: "Calle Sol 21",
				corrected: "Calle Sol 12",
				correctedById: "inst-1",
			})
			expect(typeof input.addressEditLog[0].correctedAt).toBe("string")
		})

		it("writes no log when the address was not changed", async () => {
			const input = await submitWith({ addressOriginal: "Calle Sol 12" })
			expect(input.addressEditLog).toBeUndefined()
		})

		it("writes no log when no original address was sent", async () => {
			const input = await submitWith({})
			expect(input.addressEditLog).toBeUndefined()
		})
	})

	describe("loader", () => {
		async function loadAs(role: string) {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "u1", role },
				van: { id: "van-1", active: true },
			})
			mocks.db.limitTable.findMany.mockResolvedValue([])
			mocks.getSerializedCodes.mockResolvedValue([
				{
					id: "m1",
					claroCode: "ALCLED",
					name: "ONT",
					serialPrefix: "ALCLED",
					unitPrice: "42.5",
					contractorPrice: "20",
					claroBasePrice: "30",
				},
			])
			mocks.db.serviceCode.findMany.mockResolvedValue([])
			mocks.db.serialLocation.findMany.mockResolvedValue([])
			return loader({
				request: new Request("http://localhost/installer/completion/new"),
				params: {},
				context: {},
			} as never)
		}

		it("sends an installer no price field on the serialized codes", async () => {
			const res = await loadAs("INSTALLER")
			expect(res.serializedCodes[0]).toMatchObject({ serialPrefix: "ALCLED" })
			for (const k of ["unitPrice", "contractorPrice", "claroBasePrice"])
				expect(k in res.serializedCodes[0]).toBe(false)
		})

		it("still sends an admin the unit price", async () => {
			const res = await loadAs("ADMIN")
			expect(res.serializedCodes[0]).toMatchObject({ unitPrice: 42.5 })
		})

		it("returns the accessory code names and the serials on this van", async () => {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "inst-1" },
				van: { id: "van-1", active: true },
			})
			mocks.db.limitTable.findMany.mockResolvedValue([
				{ bracketFt: 100, serviceCodeId: "sc-1", qty: 2 },
			])
			mocks.getSerializedCodes.mockResolvedValue([])
			mocks.db.serviceCode.findMany.mockResolvedValue([
				{ id: "sc-1", claroCode: "1020002", name: "Tie Wrap", unit: "EA" },
			])
			mocks.db.serialLocation.findMany.mockResolvedValue([
				{ serial: "ALCLED1" },
			])
			const res = await loader({
				request: new Request("http://localhost/installer/completion/new"),
				params: {},
				context: {},
			} as never)
			expect(res.vanSerials).toEqual(["ALCLED1"])
			expect(res.accessoryCodes[0].name).toBe("Tie Wrap")
			expect(mocks.db.serialLocation.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { status: "VAN", currentRef: "van-1" },
				}),
			)
		})
	})

	describe("offline-sync replays answer validation errors with a 422", () => {
		const base = {
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		}
		async function replay(entries: Record<string, string | File>) {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "inst-1" },
				van: { id: "van-1", active: true },
			})
			const form = new FormData()
			for (const [k, v] of Object.entries(entries)) form.set(k, v)
			return (await action({
				request: new Request("http://localhost/installer/completion/new", {
					method: "POST",
					body: form,
					headers: { "X-Offline-Sync": "true" },
				}),
				params: {},
				context: {},
			} as never)) as any
		}

		it.each([
			["order number", { claroOrderNo: " " }, "order_no_required"],
			["address", { address: "" }, "address_required"],
			["accessories", { accessories: "{bad" }, "invalid_accessories"],
		])("missing/invalid %s", async (_n, patch, key) => {
			const res = await replay({ ...base, ...patch })
			expect(res.init?.status).toBe(422)
			expect(res.data).toEqual({
				validationError: `installer.completion.errors.${key}`,
			})
			expect(mocks.submitCompletion).not.toHaveBeenCalled()
		})

		it("a form photo that fails file validation carries its message", async () => {
			const res = await replay({
				...base,
				formPhoto: new File(["x"], "a.txt", { type: "text/plain" }),
			})
			expect(res.init?.status).toBe(422)
			expect(res.data).toEqual({
				validationMessage: "Photo must be JPEG, PNG, WebP, or HEIC",
			})
		})

		it("a normal post keeps the plain error", async () => {
			mocks.requireInstaller.mockResolvedValue({
				user: { id: "inst-1" },
				van: { id: "van-1", active: true },
			})
			const form = new FormData()
			for (const [k, v] of Object.entries({ ...base, address: "" }))
				form.set(k, v)
			const res = await action({
				request: new Request("http://localhost/installer/completion/new", {
					method: "POST",
					body: form,
				}),
				params: {},
				context: {},
			} as never)
			expect(res).toEqual({
				errorKey: "installer.completion.errors.address_required",
			})
		})
	})
})
