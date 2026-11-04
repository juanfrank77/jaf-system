import { readFileSync } from "node:fs"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { makeTracker } from "~/test/helpers"
import { action } from "./_app.comptroller.brigades"

const tracker = makeTracker()
const CSV = readFileSync("docs/JAF_Brigades_Import_179.csv")
const csvCodes = readFileSync("docs/JAF_Brigades_Import_179.csv", "utf8")
	.replace(/^﻿/, "")
	.split(/\r?\n/)
	.slice(1)
	.filter(Boolean)
	.map((l) => l.split(",")[0])
const uniqueCodes = [...new Set(csvCodes)]

const request = (form: FormData) =>
	new Request("http://localhost/comptroller/brigades", {
		method: "POST",
		body: form,
	})
const run = (form: FormData) =>
	action({ request: request(form), params: {} } as any).catch(
		(r) => r,
	) as Promise<any>

const fileForm = (intent: string, name: string, data: BlobPart) => {
	const f = new FormData()
	f.set("intent", intent)
	f.set("file", new File([data], name))
	return f
}

const existingInCsv = () =>
	db.brigade.findMany({
		where: { code: { in: uniqueCodes } },
		select: { id: true, code: true },
	})

afterAll(async () => {
	// Pick up whatever the import created so the shared cleanup removes it.
	const made = await existingInCsv()
	for (const b of made) {
		if (!before.has(b.id)) tracker.track("brigade", b)
	}
	const accounts = await db.contractorAccount.findMany({
		where: {
			OR: [
				{
					brigadeId: {
						in: made.filter((b) => !before.has(b.id)).map((b) => b.id),
					},
				},
				{ code: { in: ["ZZ-OV-NEW", "ZZ-OV-OLD"] } },
			],
		},
		select: { id: true },
	})
	for (const a of accounts) tracker.track("contractorAccount", a)
	await tracker.cleanup()
})

const before = new Set<string>()

describe("brigade import actions", () => {
	beforeEach(() => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "carmen" },
			session: {},
		} as any)
	})

	it("previews without writing anything", async () => {
		for (const b of await existingInCsv()) before.add(b.id)
		const count = (await existingInCsv()).length
		const result = await run(fileForm("import_preview", "b.csv", CSV))
		expect(result.preview.rows).toHaveLength(csvCodes.length)
		expect(result.preview.plan.creates.length).toBeGreaterThan(0)
		expect(result.preview.plan.flagged.length).toBeGreaterThan(0)
		expect((await existingInCsv()).length).toBe(count)
	})

	it("applies the previewed rows: creates 179 minus the matched ones", async () => {
		const matched = new Set((await existingInCsv()).map((b) => b.code))
		const preview = await run(fileForm("import_preview", "b.csv", CSV))
		const form = new FormData()
		form.set("intent", "import_apply")
		form.set("rows", JSON.stringify(preview.preview.rows))
		const result = await run(form)
		expect(result.applied.created).toBe(
			uniqueCodes.filter((c) => !matched.has(c)).length,
		)
		const after = await existingInCsv()
		expect(new Set(after.map((b) => b.code))).toEqual(new Set(uniqueCodes))
		const created = await db.brigade.findFirst({
			where: { code: uniqueCodes.find((c) => !matched.has(c)) },
		})
		if (created && !before.has(created.id)) expect(created.active).toBe(false)
	})

	it("rejects an invalid rows payload", async () => {
		for (const rows of ["not json", "{}", JSON.stringify([{ code: 1 }])]) {
			const form = new FormData()
			form.set("intent", "import_apply")
			form.set("rows", rows)
			const result = await run(form)
			expect(result.init.status).toBe(400)
			expect(result.data.errorKey).toBe(
				"comptroller_brigades.errors.import_invalid",
			)
		}
		const tooMany = Array.from({ length: 2001 }, (_, i) => ({
			code: `X${i}`,
			name: "N",
			baseCode: null,
			isEquipmentAccount: false,
			status: "ACTIVE",
			typeHint: null,
			checkWithLissette: null,
		}))
		const form = new FormData()
		form.set("intent", "import_apply")
		form.set("rows", JSON.stringify(tooMany))
		expect((await run(form)).init.status).toBe(400)
	})

	it("gives other roles a 403 on both intents", async () => {
		vi.mocked(requireRole).mockRejectedValue(
			new Response("Forbidden", { status: 403 }),
		)
		const db0 = (await existingInCsv()).length
		const a = await run(fileForm("import_preview", "b.csv", CSV))
		const form = new FormData()
		form.set("intent", "import_apply")
		form.set("rows", "[]")
		const b = await run(form)
		expect(a.status).toBe(403)
		expect(b.status).toBe(403)
		expect((await existingInCsv()).length).toBe(db0)
	})

	it("returns an errorKey for a bad, empty, missing or oversized file", async () => {
		const bad = await run(fileForm("import_preview", "b.csv", "foo,bar\n1,2\n"))
		expect(bad.init.status).toBe(400)
		expect(bad.data.errorKey).toBe(
			"comptroller_brigades.errors.import_missing_column",
		)
		const empty = await run(fileForm("import_preview", "b.csv", ""))
		expect(empty.data.errorKey).toBe("comptroller_brigades.errors.import_empty")
		const none = new FormData()
		none.set("intent", "import_preview")
		expect((await run(none)).data.errorKey).toBe(
			"comptroller_brigades.errors.import_empty",
		)
		const big = await run(
			fileForm("import_preview", "b.csv", new Uint8Array(2 * 1024 * 1024 + 1)),
		)
		expect(big.init.status).toBe(400)
		expect(big.data.errorKey).toBe(
			"comptroller_brigades.errors.import_too_large",
		)
		const junk = await run(fileForm("import_preview", "b.xlsx", "not a zip"))
		expect(junk.init.status).toBe(400)
		expect(junk.data.errorKey).toMatch(/^comptroller_brigades\.errors\./)
	})

	it("refuses a preview of more than 2000 rows (the apply's own cap) without reading the brigades", async () => {
		const header = CSV.toString("utf8")
			.replace(/^\uFEFF/, "")
			.split(/\r?\n/)[0]
		const lines = Array.from(
			{ length: 2001 },
			(_, i) =>
				`ZZ-CAP-${i},Cap ${i}${",".repeat(header.split(",").length - 2)}`,
		)
		const spy = vi.spyOn(db.brigade, "findMany")
		try {
			const res = await run(
				fileForm("import_preview", "cap.csv", [header, ...lines].join("\n")),
			)
			expect(res.init.status).toBe(400)
			expect(res.data.errorKey).toBe(
				"comptroller_brigades.errors.import_too_large",
			)
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	it("applies an override and reports stale data", async () => {
		const b = tracker.track(
			"brigade",
			await db.brigade.create({
				data: { name: "Zzz Override Test", code: "ZZ-OV-OLD", memberIds: [] },
			}),
		)
		const csv = "code,name\nZZ-OV-NEW,Whatever Else\n"
		const preview = await run(fileForm("import_preview", "o.csv", csv))
		const brig = preview.preview.brigades.find((x: any) => x.id === b.id)
		expect(brig.selected).toBe("")
		expect(brig.options.map((o: any) => o.code)).toContain("ZZ-OV-NEW")
		const form = new FormData()
		form.set("intent", "import_apply")
		form.set("rows", JSON.stringify(preview.preview.rows))
		form.set(`override-${b.id}`, "ZZ-OV-NEW")
		const ok = await run(form)
		expect(ok.applied.recoded).toBe(1)
		expect((await db.brigade.findUnique({ where: { id: b.id } }))?.code).toBe(
			"ZZ-OV-NEW",
		)
		await db.contractorAccount.deleteMany({
			where: { code: { in: ["ZZ-OV-NEW", "ZZ-OV-OLD"] } },
		})
	})
})
