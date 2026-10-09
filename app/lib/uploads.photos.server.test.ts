import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, expect, it } from "vitest"
import { photosThatLoad } from "./uploads.server"

let root: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "jaf-photos-"))
	process.env.UPLOAD_DIR = root
	await fs.mkdir(path.join(root, "photos", "doc1"), { recursive: true })
	await fs.writeFile(path.join(root, "photos", "doc1", "ok.jpg"), "x")
	await fs.writeFile(path.join(root, "photos", "doc1", "empty.jpg"), "")
})
afterAll(async () => {
	process.env.UPLOAD_DIR = prev
	await fs.rm(root, { recursive: true, force: true })
})

it("keeps only photos whose served file exists and is non-empty", async () => {
	const photos = [
		{ localPath: "/old/machine/path/photos/doc1/ok.jpg" },
		{ localPath: "/var/jaf/uploads/photos/doc1/missing.jpg" },
		{ localPath: "/x/photos/doc1/empty.jpg" },
	]
	expect(await photosThatLoad("doc1", photos)).toEqual([photos[0]])
})
