import type { ReactElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"

let rendered: ReactElement | null = null
vi.mock("@react-pdf/renderer", async (orig) => ({
	...(await orig<typeof import("@react-pdf/renderer")>()),
	renderToBuffer: vi.fn(async (el: ReactElement) => {
		rendered = el
		return Buffer.from("%PDF")
	}),
}))

import { generatePreCertSheetPdf } from "./pre-cert-sheet.server"

/** Flatten every string/number leaf of a react element tree. */
function text(node: unknown): string {
	if (node == null || typeof node === "boolean") return ""
	if (typeof node === "string" || typeof node === "number") return String(node)
	if (Array.isArray(node)) return node.map(text).join("")
	const el = node as ReactElement<{ children?: unknown }>
	return text(el.props?.children)
}

const line = (qty: number, price: number) => ({
	serviceCodeId: `sc-${qty}`,
	claroCode: "34006301",
	accountCode: "610",
	description: "Servicio",
	installedQty: qty,
	certifiedQty: qty,
	unit: "EA",
	unitPrice: price,
	lineAmount: Math.round(qty * price * 100) / 100,
})

beforeEach(() => {
	rendered = null
})

it("prints TOTAL as the sum of the line costs", async () => {
	await generatePreCertSheetPdf({
		avisoNumber: "1",
		issuedOn: new Date(),
		title: "t",
		certifiedAddress: "a",
		lines: [line(5, 42.343), line(2, 13.8115)],
		sigSupervisor: null,
		sigSubcontractor: null,
		sigClaro: null,
	})
	// 211.72 + 27.62
	expect(text(rendered)).toContain("TOTAL $239.34")
})
