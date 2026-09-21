import { describe, expect, it } from "vitest"
import {
	buildInstallItems,
	buildInstallSubmitMissing,
	canAdvanceInstallStep,
	canSubmitInstall,
	isInstallInfoComplete,
	isInstallMaterialsComplete,
} from "./installer-install"

describe("InstallerInstallV2 wizard state", () => {
	it("requires info fields before advancing from Info", () => {
		expect(
			canAdvanceInstallStep({
				step: "info",
				claroJobReference: "",
				serviceType: "WIFI",
				date: "2026-08-13",
				lines: [],
			}),
		).toBe(false)
		expect(
			canAdvanceInstallStep({
				step: "info",
				claroJobReference: "12345678",
				serviceType: "WIFI",
				date: "2026-08-13",
				lines: [],
			}),
		).toBe(true)
	})

	it("requires at least one positive material line before Materials next", () => {
		expect(
			canAdvanceInstallStep({
				step: "materials",
				claroJobReference: "12345678",
				serviceType: "WIFI",
				date: "2026-08-13",
				lines: [{ serviceCodeId: "", qty: 1 }],
			}),
		).toBe(false)
		expect(
			canAdvanceInstallStep({
				step: "materials",
				claroJobReference: "12345678",
				serviceType: "WIFI",
				date: "2026-08-13",
				lines: [{ serviceCodeId: "sc-1", qty: 2 }],
			}),
		).toBe(true)
	})

	it("builds submit missing list from server-required fields only", () => {
		expect(
			buildInstallSubmitMissing({
				claroJobReference: "",
				serviceType: "",
				date: "",
				lines: [],
			}),
		).toEqual(["claro", "serviceType", "date", "materials"])
		expect(
			canSubmitInstall({
				claroJobReference: "12345678",
				serviceType: "WIFI",
				date: "2026-08-13",
				lines: [{ serviceCodeId: "sc-1", qty: 1 }],
			}),
		).toBe(true)
	})

	it("filters zero-qty and empty service codes from items payload", () => {
		expect(
			buildInstallItems([
				{ serviceCodeId: "sc-1", qty: 2 },
				{ serviceCodeId: "", qty: 1 },
				{ serviceCodeId: "sc-2", qty: 0 },
			]),
		).toEqual([{ serviceCodeId: "sc-1", qty: 2 }])
		expect(
			isInstallInfoComplete({
				claroJobReference: "  ",
				serviceType: "WIFI",
				date: "2026-08-13",
			}),
		).toBe(false)
		expect(
			isInstallMaterialsComplete([{ serviceCodeId: "sc-1", qty: 0 }]),
		).toBe(false)
	})
})
