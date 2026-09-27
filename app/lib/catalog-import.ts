import type { Prisma } from "../../generated/prisma/client"

type CatalogRow = {
	service_code: string
	description: string
	account_code: string
	unit: string
	claro_base_price: string
	uplift_factor: string
	jaf_price: string
	contractor_price: string
	contractor_factor: string
	price_list_revision: string
	effective_from: string
}

/** Minimal CSV parser handling quoted fields with commas and escaped quotes. */
const splitCsvLine = (line: string): string[] => {
	const cells: string[] = []
	let current = ""
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				current += char
			}
		} else {
			if (char === '"') {
				inQuotes = true
			} else if (char === ",") {
				cells.push(current.trim())
				current = ""
			} else {
				current += char
			}
		}
	}
	cells.push(current.trim())
	return cells
}

export function parseCatalogCsv(text: string): CatalogRow[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
	const header = splitCsvLine(lines[0])
	return lines.slice(1).map((line) => {
		const cells = splitCsvLine(line)
		const row: Record<string, string> = {}
		header.forEach((h, i) => {
			row[h] = (cells[i] ?? "").trim()
		})
		return row as CatalogRow
	})
}

const orNull = (v: string) => (v === "" ? null : v)

const parseDate = (value: string): Date | null => {
	const trimmed = value.trim()
	if (!trimmed) return null
	const date = new Date(`${trimmed}T00:00:00.000Z`)
	if (Number.isNaN(date.getTime())) {
		// biome-ignore lint/suspicious/noConsole: seed catalog validation output
		console.warn(`Invalid date skipped: ${trimmed}`)
		return null
	}
	return date
}

export function toServiceCodeData(
	row: CatalogRow,
): Prisma.ServiceCodeCreateManyInput {
	return {
		claroCode: row.service_code,
		name: row.description,
		kind: "SERVICE",
		// Production ServiceCode.unit is NOT NULL; blank catalog units are stored as "".
		unit: row.unit,
		unitPrice: row.jaf_price,
		claroBasePrice: orNull(row.claro_base_price),
		upliftFactor: orNull(row.uplift_factor),
		contractorPrice: orNull(row.contractor_price),
		contractorFactor: orNull(row.contractor_factor),
		priceListRevision: orNull(row.price_list_revision),
		effectiveFrom: parseDate(row.effective_from),
		accountCode: orNull(row.account_code),
		active: true,
	}
}

/** The three fabricated demo codes from the old seed. Deactivated, never deleted. */
export const LEGACY_DEMO_CODES = ["34006428", "34006429", "34006430"]

export const SUPERVISOR_SEED = [
	{
		email: "eocasio@jafcomm.local",
		name: "Edgard Ocasio",
		phone: "787-444-0165",
		areas: ["CENTRAL"],
	},
	{
		email: "cgonzalez@jafcomm.local",
		name: "Charlie González",
		phone: "787-344-0590",
		areas: ["METRO"],
	},
	{
		email: "lrivera@jafcomm.local",
		name: "Luis Rivera",
		phone: "787-718-5863",
		areas: ["NORTE"],
	},
	{
		email: "rramos@jafcomm.local",
		name: "Ramón Ramos",
		phone: "787-533-6520",
		areas: ["OESTE", "SUR"],
	},
] as const

type BrigadeSeed = {
	name: string
	code: string | null
	area: string
	supervisorEmail: string
	leadName: string
	phone: string | null
}

// Source: docs/LIST OF BRIGADES AND SUPERVISORS.xlsx (27 Aug) + docs/Brigades_Code_From_Carmen.png
export const BRIGADE_SEED: BrigadeSeed[] = [
	{
		name: "DINO CASTILLO",
		code: "209",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcomm.local",
		leadName: "Dino Castillo",
		phone: "787-617-0975",
	},
	{
		name: "ALEXIS DIAZ",
		code: "206",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcomm.local",
		leadName: "Alexis Diaz",
		phone: "787-450-5291",
	},
	{
		name: "ZARIEL GARAY",
		code: null,
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcomm.local",
		leadName: "Zariel Garay",
		phone: "787-405-5513",
	},
	{
		name: "JESUS MARTINEZ",
		code: "204",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcomm.local",
		leadName: "Jesús Martínez",
		phone: "787-647-6842",
	},
	{
		name: "SAMUEL GONZALEZ",
		code: "261",
		area: "METRO",
		supervisorEmail: "cgonzalez@jafcomm.local",
		leadName: "Samuel González",
		phone: null,
	},
	{
		name: "ANGEL JIMENEZ",
		code: "226",
		area: "METRO",
		supervisorEmail: "cgonzalez@jafcomm.local",
		leadName: "Ángel Jiménez",
		phone: "787-628-1544",
	},
	{
		name: "IR COMMUNICATION & CONSTRUCTION",
		code: "256",
		area: "METRO",
		supervisorEmail: "cgonzalez@jafcomm.local",
		leadName: "IR Communication & Construction",
		phone: "939-274-0636",
	},
	{
		name: "CARLOS MARTINEZ",
		code: "218",
		area: "NORTE",
		supervisorEmail: "lrivera@jafcomm.local",
		leadName: "Carlos Martínez",
		phone: "787-345-1460",
	},
	{
		name: "CARLOS RODRIGUEZ",
		code: "269",
		area: "NORTE",
		supervisorEmail: "lrivera@jafcomm.local",
		leadName: "Carlos Rodríguez",
		phone: null,
	},
	{
		name: "FERNANDO ROSARIO",
		code: "214",
		area: "NORTE",
		supervisorEmail: "lrivera@jafcomm.local",
		leadName: "Fernando Rosario",
		phone: "939-717-1607",
	},
	{
		name: "MIGUEL PEREZ",
		code: "272",
		area: "NORTE",
		supervisorEmail: "lrivera@jafcomm.local",
		leadName: "Miguel Pérez",
		phone: null,
	},
	{
		name: "LEONARDO RAMOS",
		code: "223",
		area: "OESTE",
		supervisorEmail: "rramos@jafcomm.local",
		leadName: "Leonardo Ramos",
		phone: "787-382-8419",
	},
	{
		name: "JUAN GARCIA",
		code: "203",
		area: "OESTE",
		supervisorEmail: "rramos@jafcomm.local",
		leadName: "Juan García",
		phone: "787-800-4744",
	},
	{
		name: "EDELMIRO BURGOS",
		code: "202",
		area: "SUR",
		supervisorEmail: "rramos@jafcomm.local",
		leadName: "Edelmiro Burgos",
		phone: "787-473-7410",
	},
]

// The two real warehouses (Phase 0 §4). `zone` is display-only (`_app.docs.$id_.sign.tsx`
// renders "name — zone"); a region label is enough. Addresses per the warehouse specs.
export const WAREHOUSE_SEED = [
	{
		name: "Guaynabo",
		zone: "Metro",
		location: "Calle Apama",
	},
	{
		name: "Arecibo",
		zone: "Norte",
		location: "Calle Ramón Moncho Nieves, Sabana Hoyos",
	},
] as const

type WarehouseStaffSeed = {
	email: string
	name: string
	phone: string | null
	warehouseName: string
	isLead: boolean
}

// Real warehouse staff (Phase 0 §3/§4). Orlando's email is real; Frank/Gilberto have no
// email on file, so they get realistic placeholders on jafcom.net. Lead flags: Orlando→Guaynabo,
// Frank→Arecibo, Gilberto counter (no lead). Gilberto's warehouse is not documented — assigned to
// Guaynabo (matches the inventory-audit spec's own seed); confirm with the client.
export const WAREHOUSE_STAFF_SEED: WarehouseStaffSeed[] = [
	{
		email: "oguzman@jafcom.net",
		name: "Orlando Guzmán",
		phone: "939-244-6470",
		warehouseName: "Guaynabo",
		isLead: true,
	},
	{
		email: "framos@jafcom.net",
		name: "Frank Ramos",
		phone: "787-612-8190",
		warehouseName: "Arecibo",
		isLead: true,
	},
	{
		email: "gayala@jafcom.net",
		name: "Gilberto Ayala",
		phone: "787-932-0237",
		warehouseName: "Guaynabo",
		isLead: false,
	},
]

// Backup authorizers (Phase 0 §3). Accounts are created now; their warehouse lead assignment
// is deferred until the client confirms which warehouse(s) — checklist: "leads by assignment when confirmed".
export const WAREHOUSE_BACKUP_SEED = [
	{ email: "amedina@jafcom.net", name: "Alfredo Medina", phone: null },
	{ email: "cgarcia@jafcom.net", name: "Catherine García", phone: null },
] as const

type InstallerRosterRow = {
	name: string
	jafNumber: string
	toaNumber: string
	region: string | null
	email: string
}

// docs/JAF_Installer_Roster_seed.csv — cleansed from LISTADO INSTALADORES ACTIVOS
// AGOSTO 8 2024.xlsx (see docs/JAF_Installer_Roster_notes.md for the cleansing pass).
export function parseInstallerRosterCsv(text: string): InstallerRosterRow[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
	const header = splitCsvLine(lines[0])
	const seen = new Set<string>()
	const out: InstallerRosterRow[] = []
	for (const line of lines.slice(1)) {
		const cells = splitCsvLine(line)
		const row: Record<string, string> = {}
		header.forEach((h, i) => {
			row[h] = (cells[i] ?? "").trim()
		})
		if (!row.toa_number || seen.has(row.toa_number)) continue
		seen.add(row.toa_number)
		out.push({
			name: row.name,
			jafNumber: row.jaf_number,
			toaNumber: row.toa_number,
			region: row.region === "" ? null : row.region,
			email: row.email,
		})
	}
	return out
}

// Orlando's per-order accessory ceiling by drop-footage bracket
// (docs/JAF_Package/06 Fee, Material and Crew Codes/Limite de materiales por orden .xlsx).
// None of the 7 accessory names in that sheet (JOTAS, MORDAZAS, SPAN CLAMP, HOOK,
// TORNILLO HOOK, TIE WRAP, MOUNTING) match a claroCode in the 934-row service catalog —
// they aren't Claro-billed line items, so no SAP code exists for them yet (spec §15:
// "Tie-wrap/Mounting SAP codes ... Orlando ... placeholder codes + needsCode"). Seeded
// under synthetic NEEDS_CODE_* claroCodes (see seedNeedsCodePlaceholders in prisma/seed.ts)
// so the bracket-prefill demo is exercisable; swap in the real SAP codes once Orlando confirms.
export const LIMIT_TABLE_SEED: {
	bracketFt: number
	claroCode: string
	qty: number
}[] = (
	[
		[100, 1, 5, 1, 1, 1, 15, 15],
		[150, 1, 5, 1, 1, 1, 15, 15],
		[200, 1, 5, 1, 1, 1, 15, 15],
		[250, 2, 7, 1, 1, 1, 15, 15],
		[350, 2, 7, 1, 1, 1, 15, 15],
		[500, 3, 10, 1, 1, 1, 15, 15],
		[750, 3, 10, 1, 1, 1, 15, 15],
		[1000, 4, 13, 1, 1, 1, 15, 15],
		[1250, 4, 15, 1, 1, 1, 15, 15],
		[2000, 4, 20, 1, 1, 1, 15, 15],
	] as const
).flatMap(
	([
		bracketFt,
		jotas,
		mordazas,
		spanClamp,
		hook,
		tornilloHook,
		tieWrap,
		mounting,
	]) => [
		{ bracketFt, claroCode: "NEEDS_CODE_JOTAS", qty: jotas },
		{ bracketFt, claroCode: "NEEDS_CODE_MORDAZAS", qty: mordazas },
		{ bracketFt, claroCode: "NEEDS_CODE_SPAN_CLAMP", qty: spanClamp },
		{ bracketFt, claroCode: "NEEDS_CODE_HOOK", qty: hook },
		{ bracketFt, claroCode: "NEEDS_CODE_TORNILLO_HOOK", qty: tornilloHook },
		{ bracketFt, claroCode: "NEEDS_CODE_TIE_WRAP", qty: tieWrap },
		{ bracketFt, claroCode: "NEEDS_CODE_MOUNTING", qty: mounting },
	],
)

// The 7 NEEDS_CODE_* accessory placeholders LIMIT_TABLE_SEED references, so seedLimitTable
// has a ServiceCode row to attach to (none of these have a real Claro SAP code yet).
export const LIMIT_TABLE_PLACEHOLDER_CODES: {
	claroCode: string
	name: string
}[] = [
	{ claroCode: "NEEDS_CODE_JOTAS", name: "JOTAS (needs SAP code)" },
	{ claroCode: "NEEDS_CODE_MORDAZAS", name: "MORDAZAS (needs SAP code)" },
	{ claroCode: "NEEDS_CODE_SPAN_CLAMP", name: "SPAN CLAMP (needs SAP code)" },
	{ claroCode: "NEEDS_CODE_HOOK", name: "HOOK (needs SAP code)" },
	{
		claroCode: "NEEDS_CODE_TORNILLO_HOOK",
		name: "TORNILLO HOOK (needs SAP code)",
	},
	{ claroCode: "NEEDS_CODE_TIE_WRAP", name: "TIE WRAP (needs SAP code)" },
	{ claroCode: "NEEDS_CODE_MOUNTING", name: "MOUNTING (needs SAP code)" },
]

// Serial-prefix → SKU resolution for the serialized modem/ONT/STB units. No source in the
// package names real Claro SAP codes for hardware serials (the 934-row catalog is
// Claro-billed service/labor line items, not an equipment SKU list) — synthetic, same
// tier as the placeholder van assignment + opening stock (spec §10/§15).
export const SERIALIZED_PREFIXES: {
	prefix: string
	claroCode: string
	name: string
}[] = [
	{
		prefix: "ALCLED",
		claroCode: "NEEDS_CODE_ONT",
		name: "ONT (needs real model/SAP code)",
	},
	{
		prefix: "STBHW",
		claroCode: "NEEDS_CODE_STB",
		name: "Set-Top Box (needs real model/SAP code)",
	},
]
