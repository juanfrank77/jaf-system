import { fieldMaterialsOrDefault } from "./field-materials"
import type { MaterialSource } from "./material-source"

/**
 * The JAF work order document (spec "Step 4 · Sign off", section B5): what the
 * supervisor checks and signs, and what the PDF for the Claro supervisor
 * prints. The step 4 page and the PDF render this one value, so they cannot
 * drift. It carries no price, amount or difference of any kind (rule R1).
 *
 * Photos, the blueprint and the Claro Prefield are not part of it: they go to
 * Claro as their own files in the package (step 5).
 */

export const WORK_ORDER_ISSUER = "JAF"

/** The blocks in their fixed B5 order (block 14, Generate package, is an action). */
export const WORK_ORDER_BLOCKS = [
	"workOrderNumber",
	"claroSupervisor",
	"jafSupervisor",
	"crews",
	"address",
	"description",
	"services",
	"materials",
	"fieldReport",
	"signatures",
] as const

export type WorkOrderBlock = (typeof WORK_ORDER_BLOCKS)[number]

export type WorkOrderSignature = { name: string; image: string } | "pending"

export type WorkOrderDocument = {
	workOrderNumber: string
	claroSupervisor: string | null
	jafSupervisor: string
	crews: { name: string; contractNumber: string | null }[]
	address: string
	description: string | null
	services: { code: string; description: string; qty: number }[]
	materials: {
		name: string
		used: number
		unit: string | null
		source: MaterialSource
	}[]
	/** The intake answer: false when the job skipped the warehouse. */
	materialsFromWarehouse: boolean
	/** Where the material came from on a no-warehouse job; null otherwise. */
	materialsReason: string | null
	fieldReport: string | null
	signatures: {
		supervisor: WorkOrderSignature
		warehouse: WorkOrderSignature
		crew: WorkOrderSignature
	}
}

/** The job columns the document is built from. */
export type WorkOrderSourceDoc = {
	controlNumber: string
	jobDescription: string | null
	jobAddressEstimated: string
	jobAddressActual: string | null
	sector: string | null
	direccion1: string | null
	direccion2: string | null
	latitud: string | null
	longitud: string | null
	tipo: string | null
	ciudad: string | null
	tipoPlanta: string | null
	grupoPlan: string | null
	installedServiceLines: unknown
	fieldMaterials: unknown
	materialsTaken: unknown
	fieldNotes: string | null
	materialsFromWarehouse: boolean
	materialsReason: string | null
	completionSignature: string | null
	releaseSignature: string | null
	crewSignature: string | null
}

export type WorkOrderContext = {
	claroSupervisor: { name: string } | null
	jafSupervisor: string
	/** Every brigade on the job, lead first. */
	crews: { name: string; code: string | null }[]
	materialCodes: { id: string; name: string; unit: string | null }[]
	signers: {
		supervisor: string | null
		warehouse: string | null
		crew: string | null
	}
}

const clean = (v: string | null | undefined) => v?.trim() || null

/**
 * The address on one line, in the order the Claro Aviso prints it (Sector,
 * Dirección 1 and 2, Latitud, Longitud, Tipo, Ciudad, Tipo Planta, Grupo
 * Plan). Jobs from before those fields keep their one-line address.
 */
export function workOrderAddress(
	doc: Pick<
		WorkOrderSourceDoc,
		| "jobAddressEstimated"
		| "jobAddressActual"
		| "sector"
		| "direccion1"
		| "direccion2"
		| "latitud"
		| "longitud"
		| "tipo"
		| "ciudad"
		| "tipoPlanta"
		| "grupoPlan"
	>,
): string {
	if (!clean(doc.direccion1))
		return doc.jobAddressActual ?? doc.jobAddressEstimated
	return [
		doc.sector,
		doc.direccion1,
		doc.direccion2,
		doc.latitud,
		doc.longitud,
		doc.tipo,
		doc.ciudad,
		doc.tipoPlanta,
		doc.grupoPlan,
	]
		.map(clean)
		.filter((v): v is string => v !== null)
		.join(", ")
}

const isImage = (v: string | null): v is string =>
	typeof v === "string" && v.startsWith("data:image") && v !== "data:,"

function signature(image: string | null, name: string | null) {
	return isImage(image) ? { name: name ?? "", image } : ("pending" as const)
}

type ServiceRow = { claroCode?: string; name?: string; qty?: number }

export function buildWorkOrderDocument(
	doc: WorkOrderSourceDoc,
	ctx: WorkOrderContext,
): WorkOrderDocument {
	const claro = ctx.claroSupervisor
	const installed = Array.isArray(doc.installedServiceLines)
		? (doc.installedServiceLines as ServiceRow[])
		: []
	const taken = Array.isArray(doc.materialsTaken)
		? (doc.materialsTaken as { serviceCodeId: string; qty: number }[])
		: []
	const codes = new Map(ctx.materialCodes.map((c) => [c.id, c]))
	return {
		workOrderNumber: doc.controlNumber,
		claroSupervisor: claro?.name ?? null,
		jafSupervisor: ctx.jafSupervisor,
		crews: ctx.crews.map((c) => ({ name: c.name, contractNumber: c.code })),
		address: workOrderAddress(doc),
		description: clean(doc.jobDescription),
		services: installed
			.filter((l) => (l.qty ?? 0) > 0)
			.map((l) => ({
				code: l.claroCode ?? "",
				description: l.name ?? "",
				qty: l.qty ?? 0,
			})),
		materials: fieldMaterialsOrDefault(doc.fieldMaterials, taken)
			.filter((r) => r.used > 0)
			.map((r) => {
				const code = codes.get(r.serviceCodeId)
				return {
					name: code?.name ?? r.serviceCodeId,
					used: r.used,
					unit: code?.unit ?? null,
					source: r.source,
				}
			}),
		materialsFromWarehouse: doc.materialsFromWarehouse,
		materialsReason: doc.materialsFromWarehouse
			? null
			: clean(doc.materialsReason),
		fieldReport: clean(doc.fieldNotes),
		signatures: {
			supervisor: signature(doc.completionSignature, ctx.signers.supervisor),
			warehouse: signature(doc.releaseSignature, ctx.signers.warehouse),
			crew: signature(doc.crewSignature, ctx.signers.crew),
		},
	}
}

/** 10/19/2026: the document's date, in Puerto Rico time. */
export function formatDocDate(d: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Puerto_Rico",
		month: "2-digit",
		day: "2-digit",
		year: "numeric",
	}).format(new Date(d))
}
