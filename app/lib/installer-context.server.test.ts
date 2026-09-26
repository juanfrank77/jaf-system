import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { getInstallerByToa } from "./installer-context.server"

let toa: string
beforeAll(async () => {
	toa = `jaf${Math.floor(Math.random() * 90000 + 10000)}`
	const u = await db.user.create({
		data: {
			email: `${toa}@jafcom.net`,
			name: "Test Installer",
			role: "INSTALLER",
			installerProfile: { create: { jafNumber: "1820", toaNumber: toa } },
		},
	})
	await db.van.create({ data: { name: "Van T", installerId: u.id } })
})

it("resolves an installer by TOA number", async () => {
	const u = await getInstallerByToa(toa)
	expect(u?.role).toBe("INSTALLER")
})
