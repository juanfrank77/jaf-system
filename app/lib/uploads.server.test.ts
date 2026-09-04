import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { saveUpload } from "./uploads.server"

describe("saveUpload", () => {
	const dir = path.join(os.tmpdir(), `jaf-upload-test-${Date.now()}`)
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
		delete process.env.UPLOAD_DIR
	})

	it("writes the file under UPLOAD_DIR/<kind>/<filename> and returns the path", async () => {
		process.env.UPLOAD_DIR = dir
		const file = new File([Buffer.from("%PDF-1.4 test")], "aviso.pdf", {
			type: "application/pdf",
		})
		const saved = await saveUpload("aviso-docs", "doc1-aviso.pdf", file)
		expect(saved).toBe(path.join(dir, "aviso-docs", "doc1-aviso.pdf"))
		expect((await fs.readFile(saved)).toString()).toBe("%PDF-1.4 test")
	})
})
