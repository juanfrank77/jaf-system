import { describe, expect, it } from "vitest"
import {
	CREW_QUEUE_KINDS,
	CREW_QUEUES,
	crewQueueHref,
	crewQueueWhere,
	parseCrewQueue,
} from "./crew-queues"

describe("crew queues", () => {
	it("lists the steps in job-rail order", () => {
		expect(CREW_QUEUES).toEqual(["pickup", "field", "submitted"])
	})

	it("links each queue as a dashboard stage", () => {
		expect(CREW_QUEUES.map(crewQueueHref)).toEqual([
			"/dashboard?stage=pickup",
			"/dashboard?stage=field",
			"/dashboard?stage=submitted",
		])
	})

	it("parses only known queues", () => {
		expect(parseCrewQueue("field")).toBe("field")
		expect(parseCrewQueue("review")).toBeNull()
		expect(parseCrewQueue(null)).toBeNull()
	})

	it("scopes every queue to the member's own assignments", () => {
		for (const q of CREW_QUEUES) {
			expect(crewQueueWhere(q, "u1")).toMatchObject({
				assignedCrewIds: { has: "u1" },
			})
		}
	})

	it("maps each queue to a status, with sent-back jobs under field", () => {
		expect(crewQueueWhere("pickup", "u").status).toBe("PREPPED")
		expect(crewQueueWhere("field", "u").status).toBe("SIGNED")
		expect(crewQueueWhere("submitted", "u").status).toBe("FIELD_UPDATED")
		expect(CREW_QUEUE_KINDS.field).toEqual(["sent_back", "on_site"])
	})
})
