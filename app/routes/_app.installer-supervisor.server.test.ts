import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	getInstallerRollup: vi.fn(),
	db: {
		user: { findMany: vi.fn() },
		notification: { findMany: vi.fn(), createMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/van-view.server", () => ({
	getInstallerRollup: mocks.getInstallerRollup,
}))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.installer-supervisor"

describe("GET /installer-supervisor", () => {
	beforeEach(() => vi.clearAllMocks())

	const since1 = new Date("2026-09-01T00:00:00.000Z")
	const since2 = new Date("2026-09-15T00:00:00.000Z")

	it("does not re-notify for a serial already flagged, even though the day count in the message changed", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "sup-1" } })
		mocks.getInstallerRollup.mockResolvedValue([
			{
				installerId: "inst-1",
				vanId: "van-1",
				name: "I",
				belowPar: 0,
				owedBack: 1,
				owedBackDetails: [{ serial: "S1", since: since1, sinceDays: 9 }],
				lastCompletionAt: null,
			},
		])
		mocks.db.user.findMany.mockResolvedValue([{ id: "sup-1" }])
		// Yesterday's notification for the same serial and episode, with a
		// different day count baked into its message — must still count as
		// "already sent".
		mocks.db.notification.findMany.mockResolvedValue([
			{ userId: "sup-1", docId: `owed-back:S1:${since1.toISOString()}` },
		])

		await loader({
			request: new Request("http://localhost/installer-supervisor"),
		} as never)

		expect(mocks.db.notification.createMany).not.toHaveBeenCalled()
	})

	it("notifies again when the same serial starts a new owed-back episode (returned, then re-issued and aged again)", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "sup-1" } })
		mocks.getInstallerRollup.mockResolvedValue([
			{
				installerId: "inst-1",
				vanId: "van-1",
				name: "I",
				belowPar: 0,
				owedBack: 1,
				owedBackDetails: [{ serial: "S1", since: since2, sinceDays: 8 }],
				lastCompletionAt: null,
			},
		])
		mocks.db.user.findMany.mockResolvedValue([{ id: "sup-1" }])
		// A notification exists for S1's *previous* episode (since1), not this
		// one (since2) — the new episode must still notify.
		mocks.db.notification.findMany.mockResolvedValue([])

		await loader({
			request: new Request("http://localhost/installer-supervisor"),
		} as never)

		expect(mocks.db.notification.createMany).toHaveBeenCalledWith({
			data: [
				{
					userId: "sup-1",
					docId: `owed-back:S1:${since2.toISOString()}`,
					message: "Serial S1 owed back for 8 days.",
				},
			],
		})
	})

	it("notifies once per supervisor for a newly-aged serial", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "sup-1" } })
		mocks.getInstallerRollup.mockResolvedValue([
			{
				installerId: "inst-1",
				vanId: "van-1",
				name: "I",
				belowPar: 0,
				owedBack: 1,
				owedBackDetails: [{ serial: "S2", since: since1, sinceDays: 8 }],
				lastCompletionAt: null,
			},
		])
		mocks.db.user.findMany.mockResolvedValue([{ id: "sup-1" }])
		mocks.db.notification.findMany.mockResolvedValue([])

		await loader({
			request: new Request("http://localhost/installer-supervisor"),
		} as never)

		expect(mocks.db.notification.createMany).toHaveBeenCalledWith({
			data: [
				{
					userId: "sup-1",
					docId: `owed-back:S2:${since1.toISOString()}`,
					message: "Serial S2 owed back for 8 days.",
				},
			],
		})
	})
})
