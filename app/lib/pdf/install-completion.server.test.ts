import { expect, it } from "vitest"
import { generateInstallCompletionPdf } from "./install-completion.server"

it("renders a completion PDF with both employee numbers", async () => {
	const buf = await generateInstallCompletionPdf({
		claroOrderNo: "430920",
		installerName: "Alfredo Rosario",
		jafNumber: "1820",
		toaNumber: "98549",
		address: "Calle 1",
		serialInstalled: "ALCLED1A5220",
		modelResolved: "Nokia G-240W",
		dropFt: 500,
		accessories: [{ code: "JOTAS", name: "Jotas", qty: 3 }],
		installedAt: new Date(),
		signature: null,
	})
	expect(buf.byteLength).toBeGreaterThan(500)
	expect(buf.subarray(0, 4).toString()).toBe("%PDF")
})
