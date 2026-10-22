import { describe, expect, it } from "vitest"
import {
	validateBlueprintFile,
	validateOriginalUpload,
} from "./file-upload.server"

const f = (name: string, type: string, size = 1) =>
	new File([new Uint8Array(size)], name, { type })

describe("validateOriginalUpload", () => {
	it("accepts a JPEG, a PNG and a PDF", () => {
		expect(validateOriginalUpload(f("a.jpg", "image/jpeg")).valid).toBe(true)
		expect(validateOriginalUpload(f("a.png", "image/png")).valid).toBe(true)
		expect(validateOriginalUpload(f("a.pdf", "application/pdf")).valid).toBe(
			true,
		)
	})

	it("rejects text, executables, WebP and HEIC", () => {
		expect(validateOriginalUpload(f("a.txt", "text/plain")).valid).toBe(false)
		expect(
			validateOriginalUpload(f("a.exe", "application/octet-stream")).valid,
		).toBe(false)
		expect(validateOriginalUpload(f("a.webp", "image/webp")).valid).toBe(false)
		expect(validateOriginalUpload(f("a.heic", "image/heic")).valid).toBe(false)
	})

	it("keeps the size limits: images 10 MB, PDFs 30 MB", () => {
		const mb = 1024 * 1024
		expect(
			validateOriginalUpload(f("a.jpg", "image/jpeg", 10 * mb + 1)).valid,
		).toBe(false)
		expect(
			validateOriginalUpload(f("a.pdf", "application/pdf", 11 * mb)).valid,
		).toBe(true)
		expect(
			validateOriginalUpload(f("a.pdf", "application/pdf", 30 * mb + 1)).valid,
		).toBe(false)
	})

	it("validateBlueprintFile delegates to it", () => {
		expect(validateBlueprintFile(f("a.webp", "image/webp")).valid).toBe(false)
		expect(validateBlueprintFile(f("a.pdf", "application/pdf")).valid).toBe(
			true,
		)
	})
})
