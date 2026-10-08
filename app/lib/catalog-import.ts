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

// Maintenance supervisors, one per area on the roster.
// Addresses: `charlie@` and `irivera@` are the pair on file per the client's
// account review; `eocasio@` and `rramos@` are Alex's own suggestions on
// "3. Alex IT.pdf", which he marked CONFIRM OR CORRECT and has not returned.
// UNCONFIRMED: `irivera@jafcom.net` does not match the supervisor it belongs to
// (Luis Rivera) and our own admin mockup flagged it as possibly belonging to the
// departed installer clerk — Alex must confirm before go-live. A wrong address
// here is unrecoverable in practice: these four sign in by email address, and
// `.local` (which this seed used until now) can never receive a password reset,
// so a mistyped address means a locked-out account with no recovery path.
// `BRIGADE_SEED.supervisorEmail` must use these same four strings — it is the
// only thing that links a brigade to its supervisor.
export const SUPERVISOR_SEED = [
	{
		email: "eocasio@jafcom.net",
		name: "Edgard Ocasio",
		phone: "787-444-0165",
		areas: ["CENTRAL"],
	},
	{
		email: "charlie@jafcom.net",
		name: "Charlie González",
		phone: "787-344-0590",
		areas: ["METRO"],
	},
	{
		email: "irivera@jafcom.net",
		name: "Luis Rivera",
		phone: "787-718-5863",
		areas: ["NORTE"],
	},
	{
		email: "rramos@jafcom.net",
		name: "Ramón Ramos",
		phone: "787-533-6520",
		areas: ["OESTE", "SUR"],
	},
] as const

type BrigadeSeed = {
	name: string
	/** The brigade's number on the paper Production Journal (q&a 14.1); `null`
	 * until the client confirms it. */
	code: string | null
	area: string | null
	supervisorEmail: string | null
	leadName: string
	phone: string | null
	/** Defaults to true. Only false for a brigade with journal work that is not
	 * on the active roster. */
	active?: boolean
}

// Source: `code` is the brigade number printed on the Production Journal, as
// confirmed by the client (docs/JAF_Package/finace-work-q&a.md, answer 14.1) —
// NOT the number in `Brigades_Code_From_Carmen.png`. Carmen's sheet is a
// contractor registry running 202-275 and disagrees with the journal on almost
// every brigade (Carmen 204 Jesus Martinez vs journal 009; 218 Carlos Martinez
// vs 016; 226 Angel D Jimenez vs 124; 202 Edelmiro Burgos vs 024; 247 Jose A
// Rios Rivera vs 141; 272 Miguel Perez Contractor LLC vs 176). Where the two
// sources disagree the journal wins, because it is what the report Lissette
// actually sends Carmen and what `jaf_invoice.contractorAccountCode` is matched
// against. Carmen's sheet is still the only source for a brigade the journal
// never printed — it carries 209 Dino Castillo, 261 Samuel A Gonzalez and 256
// IR Communication, none of which q&a 14.1 confirmed.
// `name` is the full name as the journal prints it (14.1), which is longer than
// the roster's short form for four brigades: Zariel Garay Sierra, Juan Garcia
// Perez, Angel D. Jimenez and Miguel Perez Vargas. The roster (Lissette's sheet)
// and the journal disagree on all four, and the journal wins because it is what
// the report Lissette actually sends Carmen.
// Four active brigades have no confirmed number yet (Dino Castillo, Samuel
// González, Carlos Rodríguez, IR Communication & Construction): they stay
// `code: null`, get no ContractorAccount, and take a number on the brigades
// screen once it is known — saving it there creates their account. Until then
// their released jobs cannot be swept into a payroll run.
// Which brigades are active, plus their `area`, `supervisorEmail` and `phone`,
// come from docs/LIST OF BRIGADES AND SUPERVISORS.xlsx ("LISTADO DE
// SUPERVISORES Y BRIGADAS ACTIVAS").
export const BRIGADE_SEED: BrigadeSeed[] = [
	{
		name: "DINO CASTILLO",
		code: null,
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcom.net",
		leadName: "Dino Castillo",
		phone: "787-617-0975",
	},
	{
		name: "ALEXIS DIAZ",
		code: "025",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcom.net",
		leadName: "Alexis Diaz",
		phone: "787-450-5291",
	},
	{
		name: "ZARIEL GARAY SIERRA",
		code: "178",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcom.net",
		leadName: "Zariel Sierra",
		phone: "787-405-5513",
	},
	{
		name: "JESUS MARTINEZ",
		code: "009",
		area: "CENTRAL",
		supervisorEmail: "eocasio@jafcom.net",
		leadName: "Jesús Martínez",
		phone: "787-647-6842",
	},
	{
		name: "SAMUEL GONZALEZ",
		code: null,
		area: "METRO",
		supervisorEmail: "charlie@jafcom.net",
		leadName: "Samuel González",
		phone: null,
	},
	{
		name: "ANGEL D JIMENEZ",
		code: "124",
		area: "METRO",
		supervisorEmail: "charlie@jafcom.net",
		leadName: "Ángel Jiménez",
		phone: "787-628-1544",
	},
	{
		name: "IR COMMUNICATION & CONSTRUCTION",
		code: null,
		area: "METRO",
		supervisorEmail: "charlie@jafcom.net",
		leadName: "IR Communication & Construction",
		phone: "939-274-0636",
	},
	{
		name: "CARLOS MARTINEZ",
		code: "016",
		area: "NORTE",
		supervisorEmail: "irivera@jafcom.net",
		leadName: "Carlos Martínez",
		phone: "787-345-1460",
	},
	{
		name: "CARLOS RODRIGUEZ",
		code: null,
		area: "NORTE",
		supervisorEmail: "irivera@jafcom.net",
		leadName: "Carlos Rodríguez",
		phone: null,
	},
	{
		name: "FERNANDO ROSARIO",
		code: "011",
		area: "NORTE",
		supervisorEmail: "irivera@jafcom.net",
		leadName: "Fernando Rosario",
		phone: "939-717-1607",
	},
	{
		name: "MIGUEL PEREZ VARGAS",
		code: "176",
		area: "NORTE",
		supervisorEmail: "irivera@jafcom.net",
		leadName: "Miguel Pérez",
		phone: null,
	},
	{
		name: "LEONARDO RAMOS",
		code: "102",
		area: "OESTE",
		supervisorEmail: "rramos@jafcom.net",
		leadName: "Leonardo Ramos",
		phone: "787-382-8419",
	},
	{
		name: "JUAN GARCIA PEREZ",
		code: "019",
		area: "OESTE",
		supervisorEmail: "rramos@jafcom.net",
		leadName: "Juan García",
		phone: "787-800-4744",
	},
	{
		name: "EDELMIRO BURGOS",
		code: "024",
		area: "SUR",
		supervisorEmail: "rramos@jafcom.net",
		leadName: "Edelmiro Burgos",
		phone: "787-473-7410",
	},
	// Has work on the journal but is not on the active roster (q&a 14.1), so it
	// is seeded inactive with no area or supervisor: it can be paid for released
	// work but is never assignable.
	{
		name: "JOSE A RIOS RIVERA",
		code: "141",
		area: null,
		supervisorEmail: null,
		leadName: "José A. Ríos Rivera",
		phone: null,
		active: false,
	},
]

// The two real warehouses (Phase 0 §4). Both the names and the addresses come
// from Orlando's own email (JAF_WareHouse_Manager_email_orlando.png): "Almacén #1
// Guaynabo: Calle Apama, Guaynabo PR" and "Almacén #2 Arecibo: Calle Ramon Moncho
// Nieves, Sabana Hoyos, Arecibo PR". Note our own mockups say "Calle Ajanta" and
// "Calle Ramón Morcelo Nieves" — those are transcription errors in the design
// samples, not a second source. `zone` is display-only
// (`_app.docs.$id_.sign.tsx` renders "name — zone"); a region label is enough.
// seedWarehouses updates `location` on an existing row, so a corrected address
// lands on re-seed.
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

// Real warehouse staff (Phase 0 §3/§4). ONLY Orlando's address is real — it is
// in his own email to JAF ("JAF_WareHouse_Manager_email_orlando.png"), which
// also gives the two warehouse addresses below. Frank Ramos and Gilberto Ayala
// appear only in our own design mockups, never in a client document: Orlando's
// data-request form ("2. orlando Wearhouse.pdf") asks who now covers the counter
// since Idamis Rivera left and leaves it blank, so `framos@` / `gayala@` are
// constructed from the name pattern and are UNCONFIRMED. Each seeded account
// gets a credential, so these are logins that exist in production on a guess.
// Lead flags: Orlando→Guaynabo, Frank→Arecibo, Gilberto counter (no lead).
// Gilberto's warehouse is not documented — assigned to Guaynabo; confirm.
// Orlando's form also asks who can authorise a release when he and Idamis are
// both out, and does not answer it: that is the gap WAREHOUSE_BACKUP_SEED below
// was invented to fill.
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
// UNCONFIRMED, like the Frank/Gilberto addresses above: both names appear in the
// "to me, Catherine, Alfredo" recipient line of Orlando's warehouse email, but no
// document gives a surname or an address for either, so `amedina@` / `cgarcia@`
// and the surnames are inferred. Each one becomes a real login in production.
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

// Orlando's per-order accessory ceiling by drop-footage bracket, transcribed
// from his email (JAF_WareHouse_Manager_email_orlando.png) and
// `Limite de materiales por orden .xlsx` — all 10 brackets and 7 limits match.
// Neither document has been confirmed back by Orlando, and the accessory names
// (JOTAS, MORDAZAS, SPAN CLAMP, HOOK, TORNILLO HOOK, TIE WRAP, MOUNTING) match
// no claroCode in the 934-row service catalog — they aren't Claro-billed line
// items, so no SAP code exists for any of them (spec §15: "Tie-wrap/Mounting
// SAP codes ... Orlando ... placeholder codes + needsCode").
// The rows are attached to synthetic NEEDS_CODE_* codes, which `seed.ts` creates
// INACTIVE. That is deliberate: they exist so `seedLimitTable` has something to
// attach to and the real quantities are ready when Orlando confirms them, but an
// active placeholder would be selectable as job material (they are the only
// MATERIAL rows in the catalog) and `getActiveServiceCodes` filters on `active`
// alone, so one could be installed and reach a real JAF invoice at $0.00. The
// cost is that material dropdowns are empty until the SAP codes are confirmed.
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
// Seeded inactive — see the LIMIT_TABLE_SEED note above for why.
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
// tier as the placeholder van assignment + opening stock (spec §10/§15), and seeded
// inactive for the same reason as the NEEDS_CODE_* accessories above.
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
