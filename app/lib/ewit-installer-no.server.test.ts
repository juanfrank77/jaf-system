import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedInstaller } from "~/test/helpers"
import { parseEwitInstallerNo } from "./ewit-installer-no"
import { setEwitInstallerNo } from "./ewit-installer-no.server"

const t = makeTracker()
// Last-5 of a per-run number keeps values unique across parallel/stray runs.
const uniq = () => String(Math.floor(10000 + Math.random() * 89999))
let a: Awaited<ReturnType<typeof seedInstaller>>
let b: Awaited<ReturnType<typeof seedInstaller>>
const noOf = async (id: string) =>
	(await db.installerProfile.findUnique({ where: { userId: id } }))
		?.ewitInstallerNo

beforeAll(async () => {
	a = await seedInstaller({ name: "EWIT A" })
	b = await seedInstaller({ name: "EWIT B" })
	for (const i of [a, b]) {
		t.track("user", i.user)
		t.track("van", i.van)
	}
})
afterAll(() => t.cleanup())

describe("setEwitInstallerNo", () => {
	it("stores the 5 digits as a string, leading zero preserved", async () => {
		const v = `0${uniq().slice(1)}`
		expect(await setEwitInstallerNo(a.user.id, v)).toEqual({ ok: true })
		expect(await noOf(a.user.id)).toBe(v)
	})

	it("rejects non-5-digit values and changes nothing", async () => {
		const before = await noOf(a.user.id)
		for (const bad of ["1821", "018211", "abcde"])
			expect(await setEwitInstallerNo(a.user.id, bad)).toEqual({
				ok: false,
				errorKey: "admin_users.errors.ewit_no_invalid",
			})
		expect(await noOf(a.user.id)).toBe(before)
	})

	it("a duplicate returns the translated error and leaves the other installer alone", async () => {
		const v = uniq()
		await setEwitInstallerNo(a.user.id, v)
		await setEwitInstallerNo(b.user.id, "00001")
		expect(await setEwitInstallerNo(b.user.id, v)).toEqual({
			ok: false,
			errorKey: "admin_users.errors.ewit_no_taken",
		})
		expect(await noOf(a.user.id)).toBe(v)
		expect(await noOf(b.user.id)).toBe("00001")
	})

	it("blank clears it", async () => {
		await setEwitInstallerNo(a.user.id, uniq())
		expect(await setEwitInstallerNo(a.user.id, "  ")).toEqual({ ok: true })
		expect(await noOf(a.user.id)).toBeNull()
	})

	it("a user with no installer profile is rejected", async () => {
		expect(await setEwitInstallerNo("nope", "01234")).toEqual({
			ok: false,
			errorKey: "admin_users.errors.update_invalid",
		})
	})
})

describe("parseEwitInstallerNo", () => {
	it("keeps leading zeros and trims", () => {
		expect(parseEwitInstallerNo("01821")).toBe("01821")
		expect(parseEwitInstallerNo(" 02009 ")).toBe("02009")
	})
	it("rejects anything that is not exactly 5 digits", () => {
		for (const bad of ["1821", "018211", "abcde", "0182a", "01 21", "-1821"])
			expect(parseEwitInstallerNo(bad)).toBeNull()
	})
	it("blank is not a number (callers treat it as clear)", () => {
		expect(parseEwitInstallerNo("")).toBeNull()
		expect(parseEwitInstallerNo("   ")).toBeNull()
	})
})
