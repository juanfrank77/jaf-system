import { describe, expect, it } from "vitest"
import {
	canApproveRestock,
	canReleaseToVan,
	canScanInReturn,
	canTransition,
	rolesMatching,
} from "./permissions"

describe("installer role gates", () => {
	it("installer supervisor and admin approve restock; installer cannot", () => {
		expect(canApproveRestock("INSTALLER_SUPERVISOR")).toBe(true)
		expect(canApproveRestock("ADMIN")).toBe(true)
		expect(canApproveRestock("INSTALLER")).toBe(false)
	})
	it("warehouse and admin release to van and scan-in", () => {
		expect(canReleaseToVan("WAREHOUSE")).toBe(true)
		expect(canScanInReturn("WAREHOUSE")).toBe(true)
		expect(canReleaseToVan("INSTALLER")).toBe(false)
	})
})

describe("rolesMatching", () => {
	it("derives the allow-list from a can*() predicate", () => {
		expect(rolesMatching(canReleaseToVan).sort()).toEqual(
			["ADMIN", "WAREHOUSE"].sort(),
		)
	})
})

describe("release signature (PREPPED -> SIGNED)", () => {
	it("is the warehouse's and admin's, no longer the crew's", () => {
		expect(canTransition("PREPPED", "SIGNED", "WAREHOUSE")).toBe(true)
		expect(canTransition("PREPPED", "SIGNED", "ADMIN")).toBe(true)
		expect(canTransition("PREPPED", "SIGNED", "CREW")).toBe(false)
	})
})
