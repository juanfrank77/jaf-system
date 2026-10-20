import { describe, expect, it } from "vitest"
import {
	buildWorkOrderDocument,
	formatDocDate,
	WORK_ORDER_BLOCKS,
	WORK_ORDER_ISSUER,
	type WorkOrderContext,
	type WorkOrderSourceDoc,
} from "./work-order-document"

const SIG = "data:image/png;base64,iVBORw0KGgo="

function doc(over: Partial<WorkOrderSourceDoc> = {}): WorkOrderSourceDoc {
	return {
		controlNumber: "MAINT-261019-001",
		jobDescription: "Pole transfer, three drops",
		jobAddressEstimated: "Calle 1, Bo. Juan Martín",
		jobAddressActual: null,
		sector: "Bo. Juan Martín",
		direccion1: "Carr. 906 Km 2.1",
		direccion2: "Frente a la escuela",
		latitud: "18.05",
		longitud: "-65.88",
		tipo: "Aéreo",
		ciudad: "Yabucoa",
		tipoPlanta: "Cobre",
		grupoPlan: "G1",
		ordenNumber: "ORD-77",
		pedido: "PED-12",
		smr: "SMR-9",
		titulo: "Poste caído",
		installedServiceLines: [
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				name: "TRANSFER ATTCH",
				qty: 5,
				unitPrice: 42.343,
				lineAmount: 211.72,
			},
			{
				serviceCodeId: "c2",
				claroCode: "34007030",
				accountCode: "6102",
				name: "REMOCION",
				qty: 0,
			},
		],
		fieldMaterials: [
			{
				serviceCodeId: "m1",
				used: 40,
				returned: 2,
				source: "WAREHOUSE_ISSUE",
			},
			{ serviceCodeId: "m2", used: 3, returned: 0, source: "BRIGADE_STOCK" },
			{ serviceCodeId: "m3", used: 1, returned: 0, source: "CLARO_DROP_OFF" },
		],
		materialsTaken: [{ serviceCodeId: "m1", qty: 42 }],
		fieldNotes: "Two drops replaced.",
		blueprintPaths: [],
		completionSignature: SIG,
		releaseSignature: SIG,
		crewSignature: SIG,
		...over,
	}
}

function ctx(over: Partial<WorkOrderContext> = {}): WorkOrderContext {
	return {
		claroSupervisor: {
			name: "Ana Rivera",
			requiresPrefield: true,
			requiresBlueprint: false,
		},
		jafSupervisor: "Edgard Ocasio",
		crews: [{ name: "JESUS MARTINEZ", code: "009" }],
		materialCodes: [
			{ id: "m1", name: "CABLE", unit: "FT" },
			{ id: "m2", name: "CLAMP", unit: "EA" },
			{ id: "m3", name: "CONNECTOR", unit: null },
		],
		photos: { before: ["b.png"], during: [], after: ["a.png"] },
		blueprints: [],
		signers: {
			supervisor: "Edgard Ocasio",
			warehouse: "Wanda Almacén",
			crew: "JESUS MARTINEZ",
		},
		...over,
	}
}

/** Every key at any depth of a plain value. */
function keysDeep(v: unknown): string[] {
	if (Array.isArray(v)) return v.flatMap(keysDeep)
	if (v && typeof v === "object")
		return Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)])
	return []
}

describe("buildWorkOrderDocument", () => {
	it("returns the blocks in the fixed B5 order", () => {
		const d = buildWorkOrderDocument(doc(), ctx())
		expect(Object.keys(d)).toEqual([...WORK_ORDER_BLOCKS])
		expect(WORK_ORDER_BLOCKS).toEqual([
			"workOrderNumber",
			"claroSupervisor",
			"jafSupervisor",
			"crews",
			"address",
			"description",
			"services",
			"materials",
			"photos",
			"blueprint",
			"prefield",
			"fieldReport",
			"signatures",
		])
	})

	it("carries no price, amount or difference anywhere", () => {
		const d = buildWorkOrderDocument(doc(), ctx())
		const keys = keysDeep(d)
		for (const k of [
			"price",
			"unitPrice",
			"lineAmount",
			"difference",
			"returned",
		])
			expect(keys).not.toContain(k)
		expect(JSON.stringify(d)).not.toMatch(/211\.72|42\.343/)
	})

	it("fills each block from the job", () => {
		const d = buildWorkOrderDocument(doc(), ctx())
		expect(d.workOrderNumber).toBe("MAINT-261019-001")
		expect(d.claroSupervisor).toBe("Ana Rivera")
		expect(d.jafSupervisor).toBe("Edgard Ocasio")
		expect(d.crews).toEqual([{ name: "JESUS MARTINEZ", contractNumber: "009" }])
		expect(d.description).toBe("Pole transfer, three drops")
		// Done work only: a zero actual is not a line.
		expect(d.services).toEqual([
			{ code: "34006301", description: "TRANSFER ATTCH", qty: 5 },
		])
		expect(d.materials).toEqual([
			{ name: "CABLE", used: 40, unit: "FT", source: "WAREHOUSE_ISSUE" },
			// Old BRIGADE_STOCK rows read as Truck stock; every Source prints.
			{ name: "CLAMP", used: 3, unit: "EA", source: "TRUCK_STOCK" },
			{ name: "CONNECTOR", used: 1, unit: null, source: "CLARO_DROP_OFF" },
		])
		expect(d.photos).toEqual({
			before: ["b.png"],
			during: [],
			after: ["a.png"],
		})
		expect(d.fieldReport).toBe("Two drops replaced.")
	})

	it("prints the address whole, in the Aviso's field order", () => {
		const d = buildWorkOrderDocument(doc(), ctx())
		expect(d.address).toBe(
			"Bo. Juan Martín, Carr. 906 Km 2.1, Frente a la escuela, 18.05, -65.88, Aéreo, Yabucoa, Cobre, G1",
		)
	})

	it("falls back to the one-line address on a job from before the Aviso fields", () => {
		const d = buildWorkOrderDocument(
			doc({
				direccion1: null,
				sector: null,
				direccion2: null,
				latitud: null,
				longitud: null,
				tipo: null,
				ciudad: null,
				tipoPlanta: null,
				grupoPlan: null,
				jobAddressActual: "CAM 906, Yabucoa",
			}),
			ctx(),
		)
		expect(d.address).toBe("CAM 906, Yabucoa")
	})

	it("lists every crew of a shared job, lead first", () => {
		const d = buildWorkOrderDocument(
			doc(),
			ctx({
				crews: [
					{ name: "JESUS MARTINEZ", code: "009" },
					{ name: "LUIS ORTIZ", code: null },
				],
			}),
		)
		expect(d.crews).toEqual([
			{ name: "JESUS MARTINEZ", contractNumber: "009" },
			{ name: "LUIS ORTIZ", contractNumber: null },
		])
	})

	it("shows a missing warehouse or crew signature as pending", () => {
		const d = buildWorkOrderDocument(
			doc({ releaseSignature: null, crewSignature: "data:," }),
			ctx({
				signers: { supervisor: "Edgard Ocasio", warehouse: null, crew: null },
			}),
		)
		expect(d.signatures.warehouse).toBe("pending")
		expect(d.signatures.crew).toBe("pending")
		expect(d.signatures.supervisor).toEqual({
			name: "Edgard Ocasio",
			image: SIG,
		})
	})

	it("stores the signer names with the images", () => {
		const d = buildWorkOrderDocument(doc(), ctx())
		expect(d.signatures).toEqual({
			supervisor: { name: "Edgard Ocasio", image: SIG },
			warehouse: { name: "Wanda Almacén", image: SIG },
			crew: { name: "JESUS MARTINEZ", image: SIG },
		})
	})

	it("the supervisor's own box is pending until they sign", () => {
		const d = buildWorkOrderDocument(doc({ completionSignature: null }), ctx())
		expect(d.signatures.supervisor).toBe("pending")
	})

	it("Prefield is not_required when the Claro supervisor does not require it", () => {
		const off = buildWorkOrderDocument(
			doc(),
			ctx({
				claroSupervisor: {
					name: "Ana Rivera",
					requiresPrefield: false,
					requiresBlueprint: false,
				},
			}),
		)
		expect(off.prefield).toBe("not_required")
		const on = buildWorkOrderDocument(doc(), ctx())
		expect(on.prefield).toEqual({
			ordenNumber: "ORD-77",
			pedido: "PED-12",
			smr: "SMR-9",
			titulo: "Poste caído",
		})
	})

	it("blueprint is not_required when none is required or attached", () => {
		expect(buildWorkOrderDocument(doc(), ctx()).blueprint).toBe("not_required")
		expect(
			buildWorkOrderDocument(
				doc({ blueprintPaths: ["/u/plan.png"] }),
				ctx({ blueprints: ["/files/plan.png"] }),
			).blueprint,
		).toEqual(["/files/plan.png"])
		// Required but missing: an empty list, never "not required".
		expect(
			buildWorkOrderDocument(
				doc(),
				ctx({
					claroSupervisor: {
						name: "Ana Rivera",
						requiresPrefield: false,
						requiresBlueprint: true,
					},
				}),
			).blueprint,
		).toEqual([])
	})

	it("the issuer is JAF", () => {
		expect(WORK_ORDER_ISSUER).toBe("JAF")
	})
})

describe("formatDocDate", () => {
	it("prints MM/DD/YYYY in Puerto Rico time", () => {
		expect(formatDocDate(new Date("2026-10-19T15:00:00Z"))).toBe("10/19/2026")
		// 02:00 UTC on the 20th is still the 19th in Puerto Rico.
		expect(formatDocDate(new Date("2026-10-20T02:00:00Z"))).toBe("10/19/2026")
	})
})
