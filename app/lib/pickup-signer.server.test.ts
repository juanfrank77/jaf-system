import { describe, expect, it } from "vitest"
import { pickupSigner } from "./pickup-signer.server"

const crew = [
	{ id: "c1", name: "Jesus Martinez" },
	{ id: "c2", name: "Maria Lopez" },
]

describe("pickupSigner", () => {
	it("picks the CREW user named leadName", () => {
		expect(
			pickupSigner({ leadName: "Maria Lopez", memberIds: ["c1"] }, crew),
		).toEqual(crew[1])
	})
	it("matches the lead by name ignoring case and surrounding spaces", () => {
		expect(
			pickupSigner({ leadName: "  maria LOPEZ ", memberIds: ["c1"] }, crew),
		).toEqual(crew[1])
		expect(
			pickupSigner({ leadName: "Maria Lopez", memberIds: ["c1"] }, [
				{ id: "c1", name: "Jesus Martinez" },
				{ id: "c3", name: " MARIA LOPEZ" },
			]),
		).toEqual({ id: "c3", name: " MARIA LOPEZ" })
	})
	it("falls back to the first member that is an active CREW user", () => {
		expect(
			pickupSigner({ leadName: "Ghost", memberIds: ["x", "c2", "c1"] }, crew),
		).toEqual(crew[1])
	})
	it("is null with no brigade or no CREW match", () => {
		expect(pickupSigner(null, crew)).toBeNull()
		expect(pickupSigner({ leadName: null, memberIds: ["x"] }, crew)).toBeNull()
	})
})
