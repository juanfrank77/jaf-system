import { coercePoRead, type PoRead } from "~/lib/po-reading"

/** Reads one PO PDF. Injected so tests and a future mailbox feed share the screen. */
export type PoReader = (pdf: Uint8Array) => Promise<PoRead>

const PROMPT = `This is a Claro / PR Telephone purchase order ("PEDIDO / PURCHASE ORDER"), possibly a scan. Read the page images, not any text layer. Record exactly what is printed:
- poNumber: the 10-digit order number under PEDIDO.
- poDate: the FECHA / DATE exactly as printed (DD.MM.YYYY, day first).
- statedPages: N from "HOJA NO./PAGE  n de/of N".
- termsDays: days from the payment terms ("VENCIMIENTO EN 60 DIAS").
- avisoCandidates: every 8-digit number in the delivery/conditions box (CONDICIONES DE ENTREGA), most likely Aviso first.
- lines: one per item line with an amount: item (e.g. 00010), description, amount (net price before IVU), ivuRate (4 or 11.5, as the line's own tax rate), ivu (that line's IVU).
- subtotal, ivu4 (total IVU at 4%), ivu115 (total IVU at 11.5%), total (grand total USD).
Use null for anything you cannot read; never guess.`

const SCHEMA = {
	type: "object",
	properties: {
		poNumber: { type: ["string", "null"] },
		poDate: { type: ["string", "null"] },
		statedPages: { type: ["number", "null"] },
		termsDays: { type: ["number", "null"] },
		avisoCandidates: { type: "array", items: { type: "string" } },
		lines: {
			type: "array",
			items: {
				type: "object",
				properties: {
					item: { type: "string" },
					description: { type: "string" },
					amount: { type: "number" },
					ivuRate: { type: "number" },
					ivu: { type: "number" },
				},
				required: ["amount", "ivuRate", "ivu"],
			},
		},
		subtotal: { type: ["number", "null"] },
		ivu4: { type: ["number", "null"] },
		ivu115: { type: ["number", "null"] },
		total: { type: ["number", "null"] },
	},
	required: ["poNumber", "poDate", "lines", "subtotal", "total"],
}

/** Claude reads the PDF natively, scans included. Needs ANTHROPIC_API_KEY. */
function claudePoReader(apiKey: string): PoReader {
	return async (pdf) => {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: process.env.PO_READER_MODEL || "claude-sonnet-5-5",
				max_tokens: 4096,
				tools: [
					{
						name: "record_po",
						description: "Record what the purchase order says",
						input_schema: SCHEMA,
					},
				],
				tool_choice: { type: "tool", name: "record_po" },
				messages: [
					{
						role: "user",
						content: [
							{
								type: "document",
								source: {
									type: "base64",
									media_type: "application/pdf",
									data: Buffer.from(pdf).toString("base64"),
								},
							},
							{ type: "text", text: PROMPT },
						],
					},
				],
			}),
		})
		if (!res.ok) throw new Error(`reader ${res.status}`)
		const body = (await res.json()) as {
			content?: { type: string; input?: unknown }[]
		}
		const tool = body.content?.find((c) => c.type === "tool_use")
		if (!tool) throw new Error("reader returned no result")
		return coercePoRead(tool.input)
	}
}

/** The configured reader, or null when no key is set (POs then wait for hand entry). */
export function getPoReader(): PoReader | null {
	const key = process.env.ANTHROPIC_API_KEY
	return key ? claudePoReader(key) : null
}
