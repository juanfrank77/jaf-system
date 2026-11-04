import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn(),
	send: vi.fn(),
	check: vi.fn(),
	mark: vi.fn(),
	plan: vi.fn(),
	build: vi.fn(),
	email: vi.fn(),
}))
vi.mock("~/lib/db.server", () => ({
	db: {
		bankSchedule: { findUnique: mocks.findUnique, update: mocks.update },
	},
}))
vi.mock("~/lib/packet-mail.server", () => ({ sendPacketEmail: mocks.send }))
vi.mock("~/lib/pbcc-batch.server", () => ({
	checkBatch: mocks.check,
	markBatchSent: mocks.mark,
}))
vi.mock("~/lib/pbcc-package.server", () => ({
	planPackage: mocks.plan,
	buildPackagePart: mocks.build,
}))
vi.mock("~/lib/system-settings.server", () => ({ getPbccEmail: mocks.email }))

import { sendBatchToPbcc } from "~/lib/pbcc-send.server"

const run = () => sendBatchToPbcc({ batchId: "b1", sentById: "u1" })

describe("sendBatchToPbcc", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.findUnique.mockResolvedValue({
			closedAt: new Date(),
			sentAt: null,
			emailLog: null,
		})
		mocks.check.mockResolvedValue({ passed: true })
		mocks.email.mockResolvedValue("pbcc@example.com")
		mocks.plan.mockResolvedValue([
			{ part: 1, of: 2, subject: "JAF — PBCC Batch #1 — Part 1 of 2" },
			{ part: 2, of: 2, subject: "JAF — PBCC Batch #1 — Part 2 of 2" },
		])
		mocks.build.mockImplementation(async (_b: string, part: number) => ({
			filename: `part${part}.zip`,
			zip: Buffer.from("z"),
		}))
		mocks.send.mockResolvedValue({ outcome: "SENT" })
	})

	it("emails every part, logs each and marks the batch Sent", async () => {
		expect(await run()).toEqual({ ok: true, parts: 2 })
		expect(mocks.send).toHaveBeenCalledTimes(2)
		expect(mocks.send.mock.calls[0][0]).toMatchObject({
			to: "pbcc@example.com",
			attachments: [{ filename: "part1.zip" }],
		})
		expect(mocks.update.mock.calls[0][0].data.emailLog).toHaveLength(2)
		expect(mocks.mark).toHaveBeenCalledWith({ batchId: "b1", sentById: "u1" })
	})

	it("does not mark it Sent when a part fails, and keeps the attempt in the log", async () => {
		mocks.send
			.mockResolvedValueOnce({ outcome: "SENT" })
			.mockResolvedValueOnce({ outcome: "FAILED", error: "bounced" })
		expect(await run()).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.email_failed",
		})
		expect(mocks.mark).not.toHaveBeenCalled()
		const log = mocks.update.mock.calls[0][0].data.emailLog
		expect(log.map((e: { outcome: string }) => e.outcome)).toEqual([
			"SENT",
			"FAILED",
		])
	})

	it("says so when email is not set up on the server", async () => {
		mocks.send.mockResolvedValue({ outcome: "UNCONFIGURED" })
		expect(await run()).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.email_not_set_up",
		})
		expect(mocks.mark).not.toHaveBeenCalled()
	})

	it("needs PBCC's address and a green, closed batch, sending nothing otherwise", async () => {
		mocks.email.mockResolvedValue(null)
		expect(await run()).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.no_pbcc_email",
		})
		mocks.email.mockResolvedValue("pbcc@example.com")
		mocks.check.mockResolvedValue({ passed: false })
		expect(await run()).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.check_failed",
		})
		mocks.check.mockResolvedValue({ passed: true })
		mocks.findUnique.mockResolvedValue({
			closedAt: new Date(),
			sentAt: new Date(),
			emailLog: null,
		})
		expect(await run()).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.not_closed",
		})
		expect(mocks.send).not.toHaveBeenCalled()
	})
})
