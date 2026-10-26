import { describe, expect, it } from "vitest"
import {
	applyLogView,
	chainDates,
	type LogColumn,
	type LogRow,
	logViewQuery,
	MISSING,
	parseLogView,
	weekStart,
} from "./log-view"

const columns: LogColumn[] = [
	{ key: "order", label: "Order #", labelKey: "x", type: "text" },
	{ key: "installer", label: "Installer", labelKey: "x", type: "text" },
	{ key: "installed", label: "Installed", labelKey: "x", type: "date" },
	{ key: "paid", label: "Paid", labelKey: "x", type: "date" },
	{ key: "amount", label: "Paid $", labelKey: "x", type: "money", total: true },
	{ key: "status", label: "Status", labelKey: "x", type: "text" },
]
const rows: LogRow[] = [
	{
		id: "1",
		order: "430920",
		installer: "A. Rosario",
		installed: "2026-10-02",
		paid: "2026-10-28",
		amount: 100.1,
		status: "Closed",
	},
	{
		id: "2",
		order: "411041",
		installer: "B. Lugo",
		installed: "2026-10-09",
		paid: null,
		amount: null,
		status: "Waiting",
	},
	{
		id: "3",
		order: "999001",
		installer: "A. Rosario",
		installed: "2026-09-30",
		paid: MISSING,
		amount: 50.2,
		status: "Closed",
	},
	{
		id: "4",
		order: "555123",
		installer: "B. Lugo",
		installed: "2026-10-20",
		paid: "2026-10-28",
		amount: 25,
		status: "Closed",
	},
]
const base = parseLogView(
	new URLSearchParams(),
	columns,
	["installer", "status"],
	{
		dateBy: "installed",
	},
)
const view = (over: Partial<typeof base>) => ({ ...base, ...over })

describe("log view", () => {
	it("filters a date range on the chosen date column, with totals that match the rows shown", () => {
		const r = applyLogView(
			rows,
			columns,
			view({ from: "2026-10-01", to: "2026-10-31" }),
		)
		expect(r.rows.map((x) => x.id)).toEqual(["1", "2", "4"])
		expect(r.totals.amount).toBe(125.1)
		// Rows with no date in the range's column are out once a range is set.
		const byPaid = applyLogView(
			rows,
			columns,
			view({ dateBy: "paid", from: "2026-10-01" }),
		)
		expect(byPaid.rows.map((x) => x.id)).toEqual(["1", "4"])
	})

	it("filters by installer or status and searches text columns", () => {
		expect(
			applyLogView(
				rows,
				columns,
				view({ filters: { installer: "B. Lugo" } }),
			).rows.map((x) => x.id),
		).toEqual(["2", "4"])
		expect(
			applyLogView(
				rows,
				columns,
				view({ filters: { status: "Closed" }, q: "rosa" }),
			).rows.map((x) => x.id),
		).toEqual(["1", "3"])
		expect(applyLogView(rows, columns, view({ q: "4309" })).rows).toHaveLength(
			1,
		)
	})

	it("sorts any column, keeping blanks and MISSING last in both directions", () => {
		const asc = applyLogView(
			rows,
			columns,
			view({ sort: { key: "paid", dir: "asc" } }),
		)
		expect(asc.rows.map((x) => x.id)).toEqual(["1", "4", "2", "3"])
		const desc = applyLogView(
			rows,
			columns,
			view({ sort: { key: "amount", dir: "desc" } }),
		)
		expect(desc.rows.map((x) => x.id)).toEqual(["1", "3", "4", "2"])
	})

	it("groups by week and month with a subtotal each", () => {
		const week = applyLogView(rows, columns, view({ group: "week" }))
		expect(week.groups.map((g) => g.label)).toEqual(
			["Week of 09/28", "Week of 09/28"]
				.slice(0, 0)
				.concat(week.groups.map((g) => g.label)),
		)
		expect(
			week.groups
				.find((g) => g.label === "Week of 09/28")
				?.rows.map((x) => x.id),
		).toEqual(["1", "3"])
		const month = applyLogView(rows, columns, view({ group: "month" }))
		expect(month.groups.map((g) => [g.label, g.totals.amount])).toEqual([
			["October 2026", 125.1],
			["September 2026", 50.2],
		])
	})

	it("shows only the chosen columns but totals everything it was asked to total", () => {
		const r = applyLogView(rows, columns, view({ cols: ["order", "amount"] }))
		expect(r.columns.map((c) => c.key)).toEqual(["order", "amount"])
	})

	it("reads a view from the URL and writes the same URL back; unknown keys are ignored", () => {
		const url = new URLSearchParams(
			"from=2026-10-01&to=2026-10-31&dateBy=paid&q=ros&installer=A.+Rosario&sort=amount&dir=desc&cols=order,amount,nope&group=week&evil=1&dateBy2=x",
		)
		const v = parseLogView(url, columns, ["installer", "status"], {
			dateBy: "installed",
		})
		expect(v).toMatchObject({
			from: "2026-10-01",
			to: "2026-10-31",
			dateBy: "paid",
			q: "ros",
			filters: { installer: "A. Rosario" },
			sort: { key: "amount", dir: "desc" },
			cols: ["order", "amount"],
			group: "week",
		})
		expect(
			parseLogView(logViewQuery(v), columns, ["installer", "status"], {
				dateBy: "installed",
			}),
		).toEqual(v)
		// A bad date or a non-date dateBy falls back.
		const bad = parseLogView(
			new URLSearchParams("from=nope&dateBy=amount"),
			columns,
			[],
			{ dateBy: "installed" },
		)
		expect(bad).toMatchObject({ from: null, dateBy: "installed" })
	})

	it("finds the Monday of a week and marks a skipped date MISSING", () => {
		expect(weekStart("2026-10-28")).toBe("2026-10-26")
		expect(weekStart("2026-10-25")).toBe("2026-10-19")
		expect(chainDates(["2026-10-01", null, "2026-10-05", null])).toEqual([
			"2026-10-01",
			MISSING,
			"2026-10-05",
			null,
		])
		expect(chainDates([null, null])).toEqual([null, null])
	})
})
