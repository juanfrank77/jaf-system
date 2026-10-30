import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { runToken, seedBrigade } from "~/test/helpers"
import type { BrigadeImportRow } from "./brigade-import"
import {
	applyBrigadeImport,
	BrigadeImportStaleError,
} from "./brigade-import-apply.server"
import {
	type BrigadeImportPlan,
	planBrigadeImport,
} from "./brigade-import-plan"

const token = runToken("IMP")
const code = (s: string) => `${token}-${s}`
const brigadeIds: string[] = []

afterAll(async () => {
	const own = await db.brigade.findMany({
		where: {
			OR: [{ id: { in: brigadeIds } }, { code: { startsWith: token } }],
		},
		select: { id: true },
	})
	const ids = own.map((b) => b.id)
	await db.contractorAccount.deleteMany({
		where: {
			OR: [{ brigadeId: { in: ids } }, { code: { startsWith: token } }],
		},
	})
	await db.brigade.deleteMany({ where: { id: { in: ids } } })
})

const row = (
	c: string,
	name: string,
	extra: Partial<BrigadeImportRow> = {},
): BrigadeImportRow => ({
	code: c,
	name,
	baseCode: null,
	isEquipmentAccount: false,
	status: "ACTIVE",
	typeHint: null,
	checkWithLissette: null,
	...extra,
})

const emptyPlan = (over: Partial<BrigadeImportPlan>): BrigadeImportPlan => ({
	recodes: [],
	suggestions: [],
	creates: [],
	skipped: [],
	flagged: [],
	ignoredOverrides: [],
	...over,
})

describe("applyBrigadeImport", () => {
	it("creates inactive brigades with no area or supervisor and syncs accounts", async () => {
		const plan = emptyPlan({
			creates: [
				row(code("040"), `Piza ${token}`),
				row(code("040D"), `Piza ${token}`, {
					isEquipmentAccount: true,
					baseCode: code("040"),
				}),
			],
		})
		expect(await applyBrigadeImport(db, plan, "actor")).toEqual({
			created: 2,
			recoded: 0,
			keptAccounts: [],
		})
		const made = await db.brigade.findMany({
			where: { code: { in: plan.creates.map((r) => r.code) } },
			orderBy: { code: "asc" },
			include: { contractorAccounts: true },
		})
		expect(made).toHaveLength(2)
		for (const b of made) {
			expect(b.active).toBe(false)
			expect(b.area).toBeNull()
			expect(b.supervisorId).toBeNull()
			expect(b.contractorAccounts.map((a) => a.code)).toEqual([b.code])
			expect(b.contractorAccounts[0].active).toBe(false)
		}
		expect(made[1].isEquipmentAccount).toBe(true)
		expect(made[1].baseCode).toBe(code("040"))
	})

	it("keeps leading zeros in the code", async () => {
		const c = `${token}-007`
		await applyBrigadeImport(db, emptyPlan({ creates: [row(c, "Zero")] }), "a")
		expect((await db.brigade.findUnique({ where: { code: c } }))?.code).toBe(c)
	})

	it("recodes only the code and leaves the old account in place", async () => {
		const old = await seedBrigade({ code: code("OLD"), area: "SUR" })
		brigadeIds.push(old.id)
		await db.contractorAccount.create({
			data: { code: old.code as string, label: old.name, brigadeId: old.id },
		})
		const res = await applyBrigadeImport(
			db,
			emptyPlan({
				recodes: [
					{
						brigadeId: old.id,
						from: old.code,
						to: code("NEW"),
						confidence: "name",
					},
				],
			}),
			"a",
		)
		expect(res).toEqual({ created: 0, recoded: 1, keptAccounts: [] })
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: old.id },
			include: { contractorAccounts: { orderBy: { code: "asc" } } },
		})
		expect(after.code).toBe(code("NEW"))
		expect({
			...after,
			code: old.code,
			contractorAccounts: [],
			updatedAt: old.updatedAt,
		}).toEqual({
			...old,
			contractorAccounts: [],
		})
		expect(after.contractorAccounts.map((a) => a.code)).toEqual([
			code("NEW"),
			code("OLD"),
		])
		expect(after.contractorAccounts.every((a) => a.active)).toBe(true)
	})

	it("running the same plan twice changes nothing the second time", async () => {
		const b = await seedBrigade({ code: code("TW0") })
		brigadeIds.push(b.id)
		const plan = emptyPlan({
			creates: [row(code("TWICE"), "Twice")],
			recodes: [
				{ brigadeId: b.id, from: b.code, to: code("TW1"), confidence: "name" },
			],
		})
		expect(await applyBrigadeImport(db, plan, "a")).toEqual({
			created: 1,
			recoded: 1,
			keptAccounts: [],
		})
		expect(await applyBrigadeImport(db, plan, "a")).toEqual({
			created: 0,
			recoded: 0,
			keptAccounts: [],
		})
		expect(await db.brigade.count({ where: { code: code("TWICE") } })).toBe(1)
	})

	it("re-planning after applying finds nothing to do", async () => {
		const b = await seedBrigade({ name: `Replan ${token}`, code: code("RP0") })
		brigadeIds.push(b.id)
		const rows = [
			row(code("RP1"), `Replan ${token}`),
			row(code("RPN"), `Fresh ${token}`),
		]
		const plan = planBrigadeImport(rows, [
			{ id: b.id, name: b.name, code: b.code },
		])
		await applyBrigadeImport(db, plan, "a")
		const now = await db.brigade.findMany({
			where: { code: { startsWith: token } },
			select: { id: true, name: true, code: true },
		})
		const again = planBrigadeImport(rows, now)
		expect(again.recodes).toEqual([])
		expect(again.creates).toEqual([])
	})

	it("rolls everything back when a row fails", async () => {
		const taken = await seedBrigade({ code: code("TAKEN") })
		const mover = await seedBrigade({ code: code("MOVER") })
		brigadeIds.push(taken.id, mover.id)
		const plan = emptyPlan({
			creates: [row(code("ROLLED"), "Rolled")],
			recodes: [
				{
					brigadeId: mover.id,
					from: mover.code,
					to: taken.code as string,
					confidence: "manual",
				},
			],
		})
		await expect(applyBrigadeImport(db, plan, "a")).rejects.toThrow()
		expect(await db.brigade.count({ where: { code: code("ROLLED") } })).toBe(0)
		expect(
			(await db.brigade.findUniqueOrThrow({ where: { id: mover.id } })).code,
		).toBe(mover.code)
	})

	it("applies a full-size import (150 creates) inside the transaction limits", async () => {
		const creates = Array.from({ length: 150 }, (_, i) =>
			row(code(`BULK${i}`), `Bulk ${i} ${token}`),
		)
		const res = await applyBrigadeImport(db, emptyPlan({ creates }), "a")
		expect(res).toEqual({ created: 150, recoded: 0, keptAccounts: [] })
		expect(
			await db.contractorAccount.count({
				where: { code: { startsWith: code("BULK") }, active: false },
			}),
		).toBe(150)
		expect(
			await db.brigade.count({
				where: { code: { startsWith: code("BULK") }, active: false },
			}),
		).toBe(150)
		expect(await applyBrigadeImport(db, emptyPlan({ creates }), "a")).toEqual({
			created: 0,
			recoded: 0,
			keptAccounts: [],
		})
	}, 60_000)

	it("throws BrigadeImportStaleError when the brigade's code changed since the preview", async () => {
		const b = await seedBrigade({ code: code("ST0") })
		brigadeIds.push(b.id)
		const plan = emptyPlan({
			creates: [row(code("STALE-CREATE"), "Stale")],
			recodes: [
				{
					brigadeId: b.id,
					from: code("OTHER"),
					to: code("ST1"),
					confidence: "name",
				},
			],
		})
		await expect(applyBrigadeImport(db, plan, "a")).rejects.toBeInstanceOf(
			BrigadeImportStaleError,
		)
		expect(
			await db.brigade.count({ where: { code: code("STALE-CREATE") } }),
		).toBe(0)
		expect(
			(await db.brigade.findUniqueOrThrow({ where: { id: b.id } })).code,
		).toBe(code("ST0"))
	})

	it("never moves an account that still pays another brigade (one recoded away from that code)", async () => {
		// Brigade A was recoded away from ACC; its old account ACC stays with A
		// so jobs signed under ACC still resolve to A.
		const a = await seedBrigade({ code: code("ACC-NOW") })
		brigadeIds.push(a.id)
		await db.contractorAccount.create({
			data: { code: code("ACC"), label: a.name, brigadeId: a.id },
		})
		const res = await applyBrigadeImport(
			db,
			emptyPlan({ creates: [row(code("ACC"), `New ACC ${token}`)] }),
			"a",
		)
		expect(res).toEqual({
			created: 1,
			recoded: 0,
			keptAccounts: [code("ACC")],
		})
		const account = await db.contractorAccount.findUniqueOrThrow({
			where: { code: code("ACC") },
		})
		expect(account.brigadeId).toBe(a.id)
		expect(account.label).toBe(a.name)
		// The new brigade exists under the code all the same.
		expect(await db.brigade.count({ where: { code: code("ACC") } })).toBe(1)
	})

	it("never moves such an account on a recode either", async () => {
		const a = await seedBrigade({ code: code("RCA-NOW") })
		const b = await seedBrigade({ code: code("RCB") })
		brigadeIds.push(a.id, b.id)
		await db.contractorAccount.create({
			data: { code: code("RCA"), label: a.name, brigadeId: a.id },
		})
		const res = await applyBrigadeImport(
			db,
			emptyPlan({
				recodes: [
					{
						brigadeId: b.id,
						from: b.code,
						to: code("RCA"),
						confidence: "name",
					},
				],
			}),
			"a",
		)
		expect(res).toEqual({
			created: 0,
			recoded: 1,
			keptAccounts: [code("RCA")],
		})
		expect(
			(
				await db.contractorAccount.findUniqueOrThrow({
					where: { code: code("RCA") },
				})
			).brigadeId,
		).toBe(a.id)
	})

	it("still re-points an orphan account (no brigade) to the new brigade", async () => {
		await db.contractorAccount.create({
			data: { code: code("ORPH"), label: "Orphan", brigadeId: null },
		})
		const res = await applyBrigadeImport(
			db,
			emptyPlan({ creates: [row(code("ORPH"), `Orph ${token}`)] }),
			"a",
		)
		expect(res.keptAccounts).toEqual([])
		const made = await db.brigade.findUniqueOrThrow({
			where: { code: code("ORPH") },
		})
		expect(
			(
				await db.contractorAccount.findUniqueOrThrow({
					where: { code: code("ORPH") },
				})
			).brigadeId,
		).toBe(made.id)
	})
})
