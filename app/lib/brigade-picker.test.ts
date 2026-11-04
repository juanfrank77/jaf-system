import { describe, expect, it } from "vitest"
import {
	assignRejection,
	pickableBrigades,
	pickerState,
	toPickerBrigades,
} from "./brigade-picker"

const viewer = { id: "sup-1", areas: ["SUR"] }

function brigade(overrides: Record<string, unknown> = {}) {
	return {
		active: true,
		supervisorId: "sup-1",
		area: "METRO",
		isEquipmentAccount: false,
		terminatedAt: null as Date | null,
		...overrides,
	}
}

describe("pickerState", () => {
	it("own: an active brigade the viewer supervises", () => {
		expect(pickerState(brigade(), viewer)).toBe("own")
	})

	it("own: an active brigade in one of the viewer's areas, under someone else", () => {
		expect(
			pickerState(brigade({ supervisorId: "sup-2", area: "SUR" }), viewer),
		).toBe("own")
	})

	it("own: an active brigade with no supervisor in the viewer's area", () => {
		expect(
			pickerState(brigade({ supervisorId: null, area: "SUR" }), viewer),
		).toBe("own")
	})

	it("inactive: an inactive brigade nobody supervises, wherever it sits", () => {
		expect(
			pickerState(
				brigade({ active: false, supervisorId: null, area: null }),
				viewer,
			),
		).toBe("inactive")
		expect(
			pickerState(
				brigade({ active: false, supervisorId: null, area: "METRO" }),
				viewer,
			),
		).toBe("inactive")
	})

	it("inactive: the viewer's own inactive brigade", () => {
		expect(
			pickerState(
				brigade({ active: false, supervisorId: "sup-1", area: "METRO" }),
				viewer,
			),
		).toBe("inactive")
	})

	it("with_other: an inactive brigade still with another supervisor, even in the viewer's area", () => {
		expect(
			pickerState(
				brigade({ active: false, supervisorId: "sup-2", area: "METRO" }),
				viewer,
			),
		).toBe("with_other")
		expect(
			pickerState(
				brigade({ active: false, supervisorId: "sup-2", area: "SUR" }),
				viewer,
			),
		).toBe("with_other")
	})

	it("with_other: an active brigade under another supervisor, outside the viewer's areas", () => {
		expect(pickerState(brigade({ supervisorId: "sup-2" }), viewer)).toBe(
			"with_other",
		)
	})

	it("own: an active brigade with no supervisor is unowned, so pickable outside the viewer's areas too", () => {
		expect(
			pickerState(brigade({ supervisorId: null, area: "METRO" }), viewer),
		).toBe("own")
		expect(
			pickerState(brigade({ supervisorId: null, area: null }), viewer),
		).toBe("own")
	})

	it("hidden: an equipment (D) account, even the viewer's own or inactive", () => {
		expect(pickerState(brigade({ isEquipmentAccount: true }), viewer)).toBe(
			"hidden",
		)
		expect(
			pickerState(brigade({ isEquipmentAccount: true, active: false }), viewer),
		).toBe("hidden")
	})

	it("hidden: a terminated brigade, even the viewer's own or inactive", () => {
		expect(pickerState(brigade({ terminatedAt: new Date() }), viewer)).toBe(
			"hidden",
		)
		expect(
			pickerState(brigade({ terminatedAt: new Date(), active: false }), viewer),
		).toBe("hidden")
	})
})

describe("assignRejection", () => {
	const sup = { ...viewer, role: "SUPERVISOR" }
	it("lets a supervisor assign own and inactive brigades", () => {
		expect(assignRejection(brigade(), sup)).toBeNull()
		expect(assignRejection(brigade({ active: false }), sup)).toBeNull()
		expect(
			assignRejection(brigade({ active: false, supervisorId: null }), sup),
		).toBeNull()
	})

	it("lets a supervisor assign another supervisor's brigade, active or inactive", () => {
		expect(
			assignRejection(brigade({ active: false, supervisorId: "sup-2" }), sup),
		).toBeNull()
		expect(assignRejection(brigade({ supervisorId: "sup-2" }), sup)).toBeNull()
	})
})

describe("pickableBrigades", () => {
	const rows = [
		{ id: "own", ...brigade() },
		{ id: "inactive", ...brigade({ active: false, supervisorId: null }) },
		{ id: "other", ...brigade({ supervisorId: "sup-2" }) },
		{
			id: "other-idle",
			...brigade({ active: false, supervisorId: "sup-2" }),
		},
		{ id: "equipment", ...brigade({ isEquipmentAccount: true }) },
		{ id: "terminated", ...brigade({ terminatedAt: new Date() }) },
	]

	it("a supervisor gets every brigade except the hidden ones", () => {
		expect(
			pickableBrigades(rows, { ...viewer, role: "SUPERVISOR" }).map(
				(r) => r.id,
			),
		).toEqual(["own", "inactive", "other", "other-idle"])
	})

	it("an Admin keeps the active brigades, never hidden ones", () => {
		expect(
			pickableBrigades(rows, { id: "admin-1", role: "ADMIN", areas: [] }).map(
				(r) => r.id,
			),
		).toEqual(["own", "other"])
	})
})

describe("toPickerBrigades", () => {
	const row = (id: string, overrides: Record<string, unknown>) => ({
		id,
		name: id,
		code: null,
		leadName: null,
		supervisor: null as { name: string } | null,
		...brigade(overrides),
	})
	const rows = [
		row("idle-free", { active: false, supervisorId: null }),
		row("idle-mine", { active: false, supervisorId: "sup-1" }),
		{
			...row("idle-other", { active: false, supervisorId: "sup-2" }),
			supervisor: { name: "Ana" },
		},
	]

	it("shows a supervisor another supervisor's inactive brigade as with_other, named", () => {
		expect(
			toPickerBrigades(rows, { ...viewer, role: "SUPERVISOR" }).map((b) => [
				b.id,
				b.state,
				b.supervisorName,
			]),
		).toEqual([
			["idle-free", "inactive", null],
			["idle-mine", "inactive", null],
			["idle-other", "with_other", "Ana"],
		])
	})

	it("an Admin's picker still leaves inactive brigades out", () => {
		expect(
			toPickerBrigades(rows, { id: "admin-1", role: "ADMIN", areas: [] }),
		).toEqual([])
	})
})
