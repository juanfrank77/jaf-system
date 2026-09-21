import { describe, expect, it } from "vitest"
import { describeAuditEvent, humanizeAction } from "./audit-event"

const t = (key: string, options?: Record<string, unknown>) => {
	if (!options) return key
	const interpolated = Object.entries(options).reduce(
		(s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
		key,
	)
	return interpolated === key
		? `${key} ${JSON.stringify(options)}`
		: interpolated
}

const ctx = {
	t,
	statusLabel: (status: string | null | undefined) => status ?? "unknown",
	nameOf: (id: string) => (id === "crew-1" ? "Ana Rivera" : id),
	formatMoney: (amount: unknown) => `$${Number(amount).toFixed(2)}`,
}

const createdDiff = {
	status: { before: null, after: "CREATED" },
	brigadeId: "brigade-1",
	serviceLines: [
		{
			qty: 1,
			name: "LINEA HORA EXTRA",
			claroCode: "340005437",
			accountCode: "6",
			serviceCodeId: "svc-1",
		},
	],
}

describe("describeAuditEvent", () => {
	it("lists service lines for CREATED instead of dumping JSON", () => {
		const event = describeAuditEvent("CREATED", createdDiff, ctx)
		expect(event.titleKey).toBe("admin_history.action.CREATED")
		expect(event.detail).toBeUndefined()
		expect(event.items?.[0]).toContain("340005437")
		expect(event.items?.[0]).toContain("LINEA HORA EXTRA")
		expect(event.items?.[0]).toContain("1")
		expect(JSON.stringify(event)).not.toContain("brigadeId")
		expect(JSON.stringify(event)).not.toContain("serviceCodeId")
	})

	it("shows a status transition for STATUS_CHANGED", () => {
		const event = describeAuditEvent(
			"STATUS_CHANGED",
			{ status: { before: "CREATED", after: "PREPPED" } },
			ctx,
		)
		expect(event.titleKey).toBe("admin_history.action.STATUS_CHANGED")
		expect(event.detail).toBe(
			t("admin_history.detail.status_changed", {
				before: "CREATED",
				after: "PREPPED",
			}),
		)
	})

	it("resolves crew names on reassignment", () => {
		const event = describeAuditEvent(
			"CREW_REASSIGNED",
			{ from: ["old"], to: ["crew-1"] },
			ctx,
		)
		expect(event.detail).toBe(
			t("admin_history.detail.crew_reassigned", { names: "Ana Rivera" }),
		)
	})

	it("does not stringify unknown action payloads", () => {
		const event = describeAuditEvent(
			"SOME_NEW_ACTION",
			{ nested: { foo: "bar" }, list: [1, 2, 3] },
			ctx,
		)
		expect(event.titleKey).toBe("admin_history.action.unknown")
		expect(event.titleValues).toEqual({ action: "Some New Action" })
		expect(event.detail).toBeUndefined()
		expect(event.items).toBeUndefined()
	})

	it("includes send-back notes without raw objects", () => {
		const event = describeAuditEvent(
			"SEND_BACK",
			{ from: "SUPERVISOR_APPROVED", to: "SIGNED", note: "Fix quantities" },
			ctx,
		)
		expect(event.detail).toContain("Fix quantities")
		expect(event.detail).toContain("SUPERVISOR_APPROVED")
		expect(event.detail).toContain("SIGNED")
	})
})

describe("humanizeAction", () => {
	it("turns enum-style actions into readable labels", () => {
		expect(humanizeAction("STATUS_CHANGED")).toBe("Status Changed")
	})
})
