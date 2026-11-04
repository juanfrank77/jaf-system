import { describe, expect, it } from "vitest"
import { findPickupSigner, pickupSignerGroups } from "./pickup-signer.server"

const crew = [
	{ id: "c1", name: "Jesus Martinez" },
	{ id: "c2", name: "Maria Lopez" },
]
const brigade = (
	over: Partial<Parameters<typeof pickupSignerGroups>[0][0]>,
) => ({
	id: "b1",
	name: "JESUS MARTINEZ",
	code: "009",
	leadName: null,
	memberIds: [],
	...over,
})

describe("pickupSignerGroups", () => {
	it("lists the lead first, then the other members that have a CREW account", () => {
		const [group] = pickupSignerGroups(
			[brigade({ leadName: "Maria Lopez", memberIds: ["c1", "c2"] })],
			crew,
		)
		expect(group.signers).toEqual([
			{ key: "b1:c2", name: "Maria Lopez", userId: "c2" },
			{ key: "b1:c1", name: "Jesus Martinez", userId: "c1" },
		])
	})

	it("matches the lead by name ignoring case and surrounding spaces", () => {
		const [group] = pickupSignerGroups(
			[brigade({ leadName: "  maria LOPEZ " })],
			crew,
		)
		expect(group.signers).toEqual([
			{ key: "b1:c2", name: "Maria Lopez", userId: "c2" },
		])
	})

	it("lists a lead with no account by name: crew need no login to sign", () => {
		const [group] = pickupSignerGroups(
			[brigade({ leadName: " Carlos Rodríguez ", memberIds: ["ghost"] })],
			crew,
		)
		expect(group.signers).toEqual([
			{ key: "b1:name", name: "Carlos Rodríguez", userId: null },
		])
	})

	it("falls back to the brigade's own name when it records nobody", () => {
		const [group] = pickupSignerGroups(
			[brigade({ name: "ANGEL SERRANO", code: "001" })],
			crew,
		)
		expect(group.signers).toEqual([
			{ key: "b1:name", name: "ANGEL SERRANO", userId: null },
		])
	})

	it("returns one group per brigade on the job, in job order", () => {
		const groups = pickupSignerGroups(
			[
				brigade({ id: "b1", name: "A", code: "1", memberIds: ["c1"] }),
				brigade({ id: "b2", name: "B", code: "2", leadName: "Carlos" }),
			],
			crew,
		)
		expect(
			groups.map((g) => [g.brigadeId, g.brigadeName, g.brigadeCode]),
		).toEqual([
			["b1", "A", "1"],
			["b2", "B", "2"],
		])
		expect(groups[1].signers[0].name).toBe("Carlos")
	})

	it("is empty when the job has no brigades", () => {
		expect(pickupSignerGroups([], crew)).toEqual([])
	})
})

describe("findPickupSigner", () => {
	const groups = pickupSignerGroups(
		[
			brigade({ id: "b1", memberIds: ["c1"] }),
			brigade({ id: "b2", name: "B", leadName: "Carlos" }),
		],
		crew,
	)

	it("resolves a key to the signer and their brigade", () => {
		expect(findPickupSigner(groups, "b2:name")).toEqual({
			name: "Carlos",
			userId: null,
			brigadeId: "b2",
		})
		expect(findPickupSigner(groups, "b1:c1")).toEqual({
			name: "Jesus Martinez",
			userId: "c1",
			brigadeId: "b1",
		})
	})

	it("is null for a key that is not on this job", () => {
		expect(findPickupSigner(groups, "b9:c1")).toBeNull()
		expect(findPickupSigner(groups, "")).toBeNull()
	})
})
