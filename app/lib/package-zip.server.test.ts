import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { zipPackage } from "./package-zip.server"

describe("zipPackage", () => {
	it("stores each file's bytes as is, numbering a repeated name and skipping a missing file", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "zip-"))
		const one = path.join(dir, "one")
		const two = path.join(dir, "two")
		await Promise.all([mkdir(one), mkdir(two)])
		const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
		await writeFile(path.join(one, "a.jpg"), jpgBytes)
		await writeFile(path.join(two, "a.jpg"), "second a")
		await writeFile(path.join(dir, "wo.pdf"), "%PDF-1.4 work order")

		const zip = await zipPackage([
			{ name: "wo.pdf", path: path.join(dir, "wo.pdf") },
			{ name: "a.jpg", path: path.join(one, "a.jpg") },
			{ name: "gone.png", path: path.join(dir, "gone.png") },
			{ name: "a.jpg", path: path.join(two, "a.jpg") },
		])
		const entries = unzipSync(new Uint8Array(zip))
		expect(Object.keys(entries).sort()).toEqual(["a-2.jpg", "a.jpg", "wo.pdf"])
		expect(Buffer.from(entries["a.jpg"]).equals(jpgBytes)).toBe(true)
		expect(strFromU8(entries["a-2.jpg"])).toBe("second a")
		expect(strFromU8(entries["wo.pdf"])).toBe("%PDF-1.4 work order")
	})
})
