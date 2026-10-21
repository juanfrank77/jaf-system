import { describe, expect, it } from "vitest"
import {
	parseSupervisorQueue,
	SUPERVISOR_QUEUES,
	supervisorQueueHref,
	supervisorQueueWhere,
} from "./supervisor-queues"

describe("parseSupervisorQueue", () => {
	it("accepts every queue and rejects anything else", () => {
		for (const q of SUPERVISOR_QUEUES) expect(parseSupervisorQueue(q)).toBe(q)
		expect(parseSupervisorQueue("bogus")).toBeNull()
		expect(parseSupervisorQueue(null)).toBeNull()
	})
})

describe("supervisorQueueHref", () => {
	it("points at the dashboard's stage filter", () => {
		expect(supervisorQueueHref("aviso")).toBe("/dashboard?stage=aviso")
	})
})

describe("supervisorQueueWhere", () => {
	it("keeps Open to the steps before the packet, so Packet, Aviso and Pre-cert jobs sit only in their own queues", () => {
		expect(supervisorQueueWhere("open")).toEqual({
			releasedToFinanceAt: null,
			OR: [{ avisoNumber: null }, { avisoDocPath: null }],
			supervisorApprovedAt: null,
			jafInvoiceGeneratedAt: null,
			status: { in: ["CREATED", "PREPPED", "SIGNED", "FIELD_UPDATED"] },
		})
	})

	it("keeps Packets to Claro to signed-off jobs still waiting on the Aviso, sent or not", () => {
		const where = supervisorQueueWhere("invoice")
		expect(where).toMatchObject({
			releasedToFinanceAt: null,
			OR: [{ avisoNumber: null }, { avisoDocPath: null }],
			supervisorApprovedAt: { not: null },
		})
		expect(where).not.toHaveProperty("jafInvoiceGeneratedAt")
	})

	it("keeps Field to jobs prepped or out with the crew", () => {
		expect(supervisorQueueWhere("field")).toEqual({
			status: { in: ["PREPPED", "SIGNED"] },
		})
	})

	it("keeps Intake to jobs just created, before the warehouse has prepped them", () => {
		expect(supervisorQueueWhere("intake")).toEqual({ status: "CREATED" })
	})

	it("keeps Review to field-submitted jobs the supervisor has not approved", () => {
		expect(supervisorQueueWhere("review")).toMatchObject({
			status: "FIELD_UPDATED",
			supervisorApprovedAt: null,
		})
	})

	it("walks the milestones from Approve to Finance", () => {
		expect(supervisorQueueWhere("invoice")).toMatchObject({
			supervisorApprovedAt: { not: null },
			OR: [{ avisoNumber: null }, { avisoDocPath: null }],
		})
		expect(supervisorQueueWhere("aviso")).toMatchObject({
			jafInvoiceGeneratedAt: { not: null },
			OR: [{ avisoNumber: null }, { avisoDocPath: null }],
		})
		expect(supervisorQueueWhere("precert")).toMatchObject({
			avisoNumber: { not: null },
			avisoDocPath: { not: null },
			releasedToFinanceAt: null,
		})
		expect(supervisorQueueWhere("released")).toMatchObject({
			releasedToFinanceAt: { not: null },
		})
	})

	it("hides cancelled jobs from every step queue but never filters All by stage", () => {
		for (const q of ["invoice", "aviso", "precert", "released"] as const) {
			expect(supervisorQueueWhere(q)).toMatchObject({
				status: { not: "CANCELLED" },
			})
		}
		expect(supervisorQueueWhere("all")).toEqual({
			status: { not: "LC_REQUEST_GENERATED" },
		})
	})
})
