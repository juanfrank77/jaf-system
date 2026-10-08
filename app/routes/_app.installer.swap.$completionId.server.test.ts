import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	submitSwap: vi.fn(),
	db: {
		installCompletion: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
		serialLocation: { findMany: vi.fn() },
		user: { findMany: vi.fn().mockResolvedValue([]) },
		notification: { create: vi.fn() },
		$transaction: vi.fn(),
	},
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/swap-submit.server", () => ({ submitSwap: mocks.submitSwap }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { action, loader } from "./_app.installer.swap.$completionId"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/installer/swap/c1", {
		method: "POST",
		body: form,
	})
}

describe("POST /installer/swap/:completionId", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.db.installCompletion.findFirst.mockResolvedValue({ id: "c1" })
	})

	it("submits the swap and notifies installer supervisors + warehouse", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			van: { id: "van-1", active: true },
		})
		mocks.submitSwap.mockResolvedValue({
			swapId: "sw1",
			paymentRequestId: "pr1",
		})
		mocks.db.user.findMany.mockResolvedValue([{ id: "sup-1" }])

		const req = formRequest({
			serialOut: "OUT1",
			reason: "HARDWARE",
			serialIn: "IN1",
			newClaroOrderNo: "",
		})
		const res = await action({
			request: req,
			params: { completionId: "c1" },
		} as never)

		expect(mocks.submitSwap).toHaveBeenCalledWith(
			expect.objectContaining({
				completionId: "c1",
				serialOut: "OUT1",
				reason: "HARDWARE",
				serialIn: "IN1",
				newClaroOrderNo: undefined,
				installerId: "inst-1",
				vanId: "van-1",
			}),
			{ id: "inst-1" },
		)
		expect((res as Response).status).toBe(302)
		expect((res as Response).headers.get("Location")).toBe(
			"/installer?swapped=1",
		)
	})

	describe("validation", () => {
		const good = {
			serialOut: "OUT1",
			reason: "HARDWARE",
			serialIn: "IN1",
		}
		async function post(
			patch: Record<string, string>,
			van: unknown = { id: "van-1", active: true },
		) {
			mocks.requireInstaller.mockResolvedValue({ user: { id: "inst-1" }, van })
			return action({
				request: formRequest({ ...good, ...patch }),
				params: { completionId: "c1" },
			} as never)
		}

		it.each([
			["empty outgoing serial", { serialOut: "  " }, "serial_out_required"],
			["empty incoming serial", { serialIn: "" }, "serial_in_required"],
			["same serial in and out", { serialIn: "OUT1" }, "serials_identical"],
			["unknown reason", { reason: "BOGUS" }, "reason_required"],
		])("rejects %s without calling submitSwap", async (_n, patch, key) => {
			expect(await post(patch)).toEqual({
				errorKey: `installer.swap.errors.${key}`,
			})
			expect(mocks.submitSwap).not.toHaveBeenCalled()
		})

		it("rejects when the installer has no active van", async () => {
			expect(await post({}, { id: "van-1", active: false })).toEqual({
				errorKey: "installer.swap.errors.no_van",
			})
			expect(await post({}, null)).toEqual({
				errorKey: "installer.swap.errors.no_van",
			})
			expect(mocks.submitSwap).not.toHaveBeenCalled()
		})

		it("rejects a completion that is not this installer's", async () => {
			mocks.db.installCompletion.findFirst.mockResolvedValue(null)
			expect(await post({})).toEqual({
				errorKey: "installer.swap.errors.completion_not_found",
			})
			expect(mocks.submitSwap).not.toHaveBeenCalled()
		})

		it("turns a submitSwap throw into an error, not a 500", async () => {
			mocks.submitSwap.mockRejectedValue(new Error("boom"))
			expect(await post({})).toEqual({
				errorKey: "installer.swap.errors.swap_failed",
			})
		})

		it("still succeeds when only the notification step fails", async () => {
			mocks.submitSwap.mockResolvedValue({
				swapId: "sw1",
				paymentRequestId: "p",
			})
			mocks.db.user.findMany.mockRejectedValue(new Error("db"))
			const res = (await post({})) as Response
			expect(res.status).toBe(302)
			mocks.db.user.findMany.mockResolvedValue([])
		})
	})

	it("loader returns the recorded serial and the serials on the van", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			van: { id: "van-1", active: true },
		})
		mocks.db.installCompletion.findFirstOrThrow.mockResolvedValue({
			id: "c1",
			serialInstalled: "REC1",
		})
		mocks.db.serialLocation.findMany.mockResolvedValue([{ serial: "V1" }])
		const res = await loader({
			request: new Request("http://localhost/installer/swap/c1"),
			params: { completionId: "c1" },
		} as never)
		expect(res.completion.serialInstalled).toBe("REC1")
		expect(res.vanSerials).toEqual(["V1"])
		expect(mocks.db.serialLocation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { status: "VAN", currentRef: "van-1" },
			}),
		)
	})
})
