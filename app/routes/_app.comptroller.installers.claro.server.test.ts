import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { createElement } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { ingestAdvice } from "~/lib/payment-advice.server"
import { makeTracker, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.comptroller.installers.claro"
import { loader as lissetteLoader } from "./_app.finance.payment-advice"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-route-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

const call = (fn: typeof loader, url: string) =>
	fn({ request: new Request(url), params: {}, context: {} } as never)

const pdf = async (lines: string[]) =>
	new Uint8Array(
		await renderToBuffer(
			createElement(
				Document,
				null,
				createElement(
					Page,
					{ size: "LETTER" },
					lines.map((l) => createElement(Text, { key: l }, l)),
				),
			),
		),
	)

const money = (n: number) => n.toFixed(2)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

describe("Carmen's Claro desk vs Lissette's Payment Advice", () => {
	it("splits one advice by desk: M19 to Lissette, JA to Carmen, with the real shortfalls", async () => {
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const lissette = t.track("user", await seedUser({ role: "FINANCE" }))
		const base = 9000000 + Math.floor(Math.random() * 900000)
		let k = 0
		const mk = async (claroTotal: number | null) => {
			const number = `JA${base + k++}`
			const inv = await db.ewitInvoice.create({
				data: {
					number,
					invoiceDate: new Date("2026-09-20T12:00:00Z"),
					total: 1000,
					filePath: "/files/x.pdf",
					createdById: carmen.id,
					claroTotal,
				} as never,
			})
			t.track("ewitInvoice", { id: inv.id })
			return number
		}
		const rows: { ref: string; net: number; owed: number | null }[] = []
		for (let i = 0; i < 8; i++) {
			const owed = 1000 + i * 10
			rows.push({ ref: await mk(owed), net: owed, owed })
		}
		rows.push({
			ref: await mk(1895.06),
			net: r2(1895.06 - 37.45),
			owed: 1895.06,
		})
		rows.push({ ref: await mk(500), net: r2(500 - 18.26), owed: 500 })
		rows.push({ ref: await mk(null), net: 70, owed: null })
		rows.push({ ref: await mk(null), net: 80, owed: null })
		const m19 = [
			["M19-88012", 111.5],
			["M19-88013", 222.5],
		] as const
		const all = [
			...rows.map((r) => [r.ref, r.net] as const),
			...m19.map(([r, n]) => [r, n] as const),
		]
		const total = r2(all.reduce((s, [, n]) => s + n, 0))
		const reference = String(5600000000 + Math.floor(Math.random() * 99999999))
		const bytes = await pdf([
			"Banco Santander PR",
			"Oct. 09, 2026",
			`Referencia ${reference}`,
			...all.map(
				([r, n]) =>
					`${r} 5920050399 03.07.2026 ${money(n)} (0.00) 0.00 ${money(n)}`,
			),
			`Total $${money(total)}`,
		])
		const { id } = await ingestAdvice({ name: "oct9.pdf", bytes }, carmen.id)

		mocks.requireRole.mockResolvedValue({ user: lissette })
		const lis = await call(
			lissetteLoader as never,
			"http://localhost/finance/payment-advice?tab=upload",
		)
		const lisCard = lis.advices.find((a: { id: string }) => a.id === id)
		expect(
			lisCard?.lines.map((l: { invoiceRef: string }) => l.invoiceRef),
		).toEqual(m19.map(([r]) => r))
		const lisUn = await call(
			lissetteLoader as never,
			"http://localhost/finance/payment-advice?tab=unmatched",
		)
		expect(
			lisUn.unmatched.some((u: { invoiceRef: string }) =>
				u.invoiceRef.startsWith("JA"),
			),
		).toBe(false)
		expect("otherJaf" in lis).toBe(false)

		mocks.requireRole.mockResolvedValue({ user: carmen })
		const car = await call(
			loader,
			"http://localhost/comptroller/installers/claro?tab=upload",
		)
		const card = car.advices.find((a: { id: string }) => a.id === id)
		expect(card?.lines.length).toBe(12)
		expect(card?.lines.every((l: { otherJaf: boolean }) => l.otherJaf)).toBe(
			true,
		)
		const by = (res: string) =>
			card?.lines.filter((l: { result: string }) => l.result === res) ?? []
		expect(by("MATCHED").length).toBe(8)
		expect(by("UNMATCHED").length).toBe(2)
		const shorts = by("SHORT") as { ourTotal: number; net: number }[]
		expect(shorts.map((s) => r2(s.ourTotal - s.net))).toEqual([37.45, 18.26])
		const carUn = await call(
			loader,
			"http://localhost/comptroller/installers/claro?tab=unmatched",
		)
		expect(
			carUn.unmatched.every((u: { invoiceRef: string }) =>
				u.invoiceRef.startsWith("JA"),
			),
		).toBe(true)
		expect(
			carUn.unmatched.filter((u: { invoiceRef: string }) =>
				[rows[10].ref, rows[11].ref].includes(u.invoiceRef),
			).length,
		).toBe(2)

		// The PO arrives: Carmen's next visit re-matches the waiting row.
		await db.ewitInvoice.update({
			where: { number: rows[10].ref },
			data: { claroTotal: 70 },
		})
		const again = await call(
			loader,
			"http://localhost/comptroller/installers/claro?tab=upload",
		)
		const row10 = again.advices
			.find((a: { id: string }) => a.id === id)
			?.lines.find((l: { invoiceRef: string }) => l.invoiceRef === rows[10].ref)
		expect(row10?.result).toBe("MATCHED")
	}, 120000)

	it("accepts a short JA payment from the form only with a reason", async () => {
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		mocks.requireRole.mockResolvedValue({ user: carmen })
		const number = `JA${9900000 + Math.floor(Math.random() * 99999)}`
		const inv = await db.ewitInvoice.create({
			data: {
				number,
				invoiceDate: new Date("2026-09-20T12:00:00Z"),
				total: 100,
				filePath: "/files/x.pdf",
				createdById: carmen.id,
				claroTotal: 120,
			} as never,
		})
		t.track("ewitInvoice", { id: inv.id })
		const reference = String(5700000000 + Math.floor(Math.random() * 99999999))
		const { id } = await ingestAdvice(
			{
				name: "s.pdf",
				bytes: await pdf([
					"Oct. 09, 2026",
					`Referencia ${reference}`,
					`${number} 5920050399 03.07.2026 100.00 (0.00) 0.00 100.00`,
					"Total $100.00",
				]),
			},
			carmen.id,
		)
		const send = (f: Record<string, string>) => {
			const form = new FormData()
			for (const [k, v] of Object.entries(f)) form.set(k, v)
			return action({
				request: new Request("http://localhost/x", {
					method: "POST",
					body: form,
				}),
				params: {},
				context: {},
			} as never)
		}
		expect(await send({ intent: "apply", adviceId: id })).toEqual({})
		const line = await db.adviceLine.findFirstOrThrow({
			where: { adviceId: id },
		})
		expect(
			await send({ intent: "accept_ja_short", lineId: line.id, reason: " " }),
		).toMatchObject({ errorKey: "payment_advice.errors.reason_required" })
		expect(
			await send({ intent: "accept_ja_short", lineId: line.id, reason: "fee" }),
		).toEqual({})
		const after = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(after.shortAcceptedReason).toBe("fee")
	}, 90000)
})
