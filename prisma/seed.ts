import fs from "node:fs/promises"
import path from "node:path"
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "better-auth/crypto"
import {
	BRIGADE_SEED,
	importCatalogRows,
	LIMIT_TABLE_PLACEHOLDER_CODES,
	LIMIT_TABLE_SEED,
	parseCatalogCsv,
	parseInstallerRosterCsv,
	SERIALIZED_PREFIXES,
	SUPERVISOR_SEED,
	WAREHOUSE_BACKUP_SEED,
	WAREHOUSE_SEED,
	WAREHOUSE_STAFF_SEED,
} from "../app/lib/catalog-import"
import { PrismaClient } from "../generated/prisma/client"
import { CLARO_SUPERVISOR_LINKS } from "./claro-supervisor-links"
import { seedContractorAccounts } from "./seed-contractor-accounts"
import { seedWarehouseStartingBalances } from "./seed-warehouse-stock"

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const CSV_PATH = path.resolve(
	process.cwd(),
	"docs/JAF_Service_Catalog_seed.csv",
)
if (!process.env.SEED_TEMP_PASSWORD) {
	throw new Error(
		"SEED_TEMP_PASSWORD is required — no default credential password is shipped for seeded accounts.",
	)
}
const TEMP_PASSWORD = process.env.SEED_TEMP_PASSWORD

async function seedCatalog() {
	const rows = parseCatalogCsv(await fs.readFile(CSV_PATH, "utf8"))
	const { inserted, refreshed } = await importCatalogRows(db, rows)
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`catalog: ${rows.length} rows read, ${inserted} inserted, ${refreshed} pre-existing demo codes refreshed`,
	)
}

async function seedSupervisors() {
	const password = await hashPassword(TEMP_PASSWORD)
	for (const s of SUPERVISOR_SEED) {
		// supervisorAreas is admin-managed authorization state (set via
		// /admin/users), never re-seeded here — otherwise re-running this
		// script would silently revert whatever an admin granted or revoked.
		// Only a brand-new account gets the seed's default areas.
		const user = await db.user.upsert({
			where: { email: s.email },
			update: { name: s.name, phone: s.phone },
			create: {
				email: s.email,
				name: s.name,
				phone: s.phone,
				role: "SUPERVISOR",
				supervisorAreas: [...s.areas],
			},
		})
		await db.account.upsert({
			where: { id: `seed-${s.email}` },
			update: {},
			create: {
				id: `seed-${s.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`supervisors: ${SUPERVISOR_SEED.length} upserted (password set via SEED_TEMP_PASSWORD for newly created accounts only)`,
	)
}

async function seedBrigades() {
	const supervisors = await db.user.findMany({
		where: { email: { in: SUPERVISOR_SEED.map((s) => s.email) } },
		select: { id: true, email: true },
	})
	const byEmail = Object.fromEntries(supervisors.map((s) => [s.email, s.id]))
	for (const b of BRIGADE_SEED) {
		const data = {
			name: b.name,
			code: b.code,
			area: b.area,
			supervisorId: b.supervisorEmail
				? (byEmail[b.supervisorEmail] ?? null)
				: null,
			leadName: b.leadName,
			phone: b.phone,
			active: b.active ?? true,
		}
		// Key on `code` where the brigade has one, NOT on `name`: `Brigade.name`
		// carries no unique constraint, so a name-keyed lookup that misses (a
		// corrected spelling, a renamed brigade) silently `create`s a second row
		// for the same brigade and orphans every job referencing the original.
		// Keying on the unique `code` makes a miss impossible once prod has the
		// confirmed numbers, and `name` is written on update so a corrected name
		// lands in place instead of forking the row. Brigades with no confirmed
		// number yet still fall back to the name — the only handle they have.
		const existing = b.code
			? await db.brigade.findFirst({ where: { code: b.code } })
			: await db.brigade.findFirst({ where: { name: b.name } })
		if (existing) await db.brigade.update({ where: { id: existing.id }, data })
		else await db.brigade.create({ data: { memberIds: [], ...data } })
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`brigades: ${BRIGADE_SEED.length} upserted`)
}

async function seedWarehouses() {
	for (const w of WAREHOUSE_SEED) {
		const existing = await db.warehouse.findFirst({ where: { name: w.name } })
		if (existing)
			await db.warehouse.update({
				where: { id: existing.id },
				data: { zone: w.zone, location: w.location },
			})
		else
			await db.warehouse.create({
				data: { name: w.name, zone: w.zone, location: w.location },
			})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`warehouses: ${WAREHOUSE_SEED.length} upserted`)
}

async function seedWarehouseStaff() {
	const password = await hashPassword(TEMP_PASSWORD)
	const warehouses = await db.warehouse.findMany({
		select: { id: true, name: true },
	})
	const byName = Object.fromEntries(warehouses.map((w) => [w.name, w.id]))
	for (const s of WAREHOUSE_STAFF_SEED) {
		const user = await db.user.upsert({
			where: { email: s.email },
			update: { name: s.name, phone: s.phone, role: "WAREHOUSE" },
			create: {
				email: s.email,
				name: s.name,
				phone: s.phone,
				role: "WAREHOUSE",
			},
		})
		await db.account.upsert({
			where: { id: `seed-${s.email}` },
			update: {},
			create: {
				id: `seed-${s.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
		const warehouseId = byName[s.warehouseName]
		if (warehouseId)
			await db.warehouseAssignment.upsert({
				where: { userId_warehouseId: { userId: user.id, warehouseId } },
				update: { isLead: s.isLead },
				create: { userId: user.id, warehouseId, isLead: s.isLead },
			})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`warehouse staff: ${WAREHOUSE_STAFF_SEED.length} upserted with assignments`,
	)
}

async function seedWarehouseBackups() {
	const password = await hashPassword(TEMP_PASSWORD)
	for (const b of WAREHOUSE_BACKUP_SEED) {
		const user = await db.user.upsert({
			where: { email: b.email },
			update: { name: b.name, phone: b.phone, role: "WAREHOUSE" },
			create: {
				email: b.email,
				name: b.name,
				phone: b.phone,
				role: "WAREHOUSE",
			},
		})
		await db.account.upsert({
			where: { id: `seed-${b.email}` },
			update: {},
			create: {
				id: `seed-${b.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`warehouse backups: ${WAREHOUSE_BACKUP_SEED.length} upserted (no lead assignment — pending confirmation)`,
	)
}

// This file holds real installer PII (names, employee/TOA numbers, personal
// emails) and is gitignored — never committed. Place it at this path (or
// point INSTALLER_ROSTER_CSV_PATH at another location) before seeding.
const INSTALLER_ROSTER_CSV_PATH =
	process.env.INSTALLER_ROSTER_CSV_PATH ||
	path.resolve(process.cwd(), "docs/JAF_Installer_Roster_seed.csv")

async function seedNeedsCodePlaceholders() {
	for (const { claroCode, name } of LIMIT_TABLE_PLACEHOLDER_CODES) {
		await db.serviceCode.upsert({
			where: { claroCode },
			// Inactive, and re-asserted on every run: these are stand-ins with no
			// real Claro SAP code. Left active they are selectable as job material
			// (the only MATERIAL rows in the catalog), and `getActiveServiceCodes`
			// filters on `active` alone — so one could be installed and then bill
			// $0.00 on a real JAF invoice. `update` matters: a row seeded active by
			// an earlier run stays active otherwise.
			update: { active: false },
			create: {
				claroCode,
				name,
				kind: "MATERIAL",
				unitPrice: "0",
				active: false,
			},
		})
	}
}

async function seedSerializedFlags() {
	for (const { prefix, claroCode, name } of SERIALIZED_PREFIXES) {
		await db.serviceCode.upsert({
			where: { claroCode },
			update: { serialized: true, serialPrefix: prefix, active: false },
			create: {
				claroCode,
				name,
				kind: "MATERIAL",
				unitPrice: "0",
				active: false,
				serialized: true,
				serialPrefix: prefix,
			},
		})
	}
}

async function seedInstallers() {
	const rows = parseInstallerRosterCsv(
		await fs.readFile(INSTALLER_ROSTER_CSV_PATH, "utf8"),
	)
	const password = await hashPassword(TEMP_PASSWORD)
	for (const r of rows) {
		const user = await db.user.upsert({
			where: { email: r.email },
			update: { name: r.name },
			create: {
				email: r.email,
				name: r.name,
				role: "INSTALLER",
				installerProfile: {
					create: {
						jafNumber: r.jafNumber,
						toaNumber: r.toaNumber,
						region: r.region,
					},
				},
			},
		})
		await db.account.upsert({
			where: { id: `seed-${r.email}` },
			update: {},
			create: {
				id: `seed-${r.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`installers: ${rows.length} upserted (password set via SEED_TEMP_PASSWORD for newly created accounts only)`,
	)
}

async function seedVansAndStock() {
	// Placeholder vans (spec §10) are demo/dev scaffolding, not something a
	// real production seed should fabricate silently. Real installers whose
	// van assignment was cleared (e.g. via admin/vans unassignment) would
	// otherwise get a *new* placeholder van on every re-seed.
	if (
		process.env.SEED_DEMO_VANS !== "1" &&
		process.env.SEED_DEMO_STOCK !== "1"
	) {
		// biome-ignore lint/suspicious/noConsole: CLI seed output
		console.log(
			"placeholder vans: skipped (set SEED_DEMO_VANS=1 or SEED_DEMO_STOCK=1 to seed them)",
		)
		return
	}

	// Placeholder van numbers — client has not supplied the real van→installer map (spec §10).
	const installers = await db.user.findMany({
		where: { role: "INSTALLER" },
		orderBy: { createdAt: "asc" },
	})
	let n = 0
	for (const inst of installers) {
		const existing = await db.van.findFirst({ where: { installerId: inst.id } })
		if (existing) continue
		await db.van.create({
			data: { name: `Van P-${++n} (placeholder)`, installerId: inst.id },
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`vans: ${n} created`)

	if (process.env.SEED_DEMO_STOCK !== "1") {
		// biome-ignore lint/suspicious/noConsole: CLI seed output
		console.log(
			"synthetic opening stock: skipped (set SEED_DEMO_STOCK=1 to seed it)",
		)
		return
	}

	const vans = await db.van.findMany({
		where: { installerId: { in: installers.map((i) => i.id) } },
	})
	const serialized = await db.serviceCode.findMany({
		where: { serialized: true },
	})
	let created = 0
	for (const van of vans) {
		// Synthetic opening stock (spec §10): 2 serials per serialized SKU on the van.
		// Idempotent per serial: a serial already seeded by a prior run is left untouched
		// rather than re-writing its StockMovement, which would otherwise duplicate rows
		// in the append-only ledger on every re-run of `db seed`.
		for (const sc of serialized) {
			for (let k = 0; k < 2; k++) {
				const serial = `${sc.serialPrefix ?? "SN"}${van.id.slice(-4)}${k}${sc.claroCode.slice(-3)}`
				const alreadySeeded = await db.serialLocation.findUnique({
					where: { serial },
				})
				if (alreadySeeded) continue
				await db.serialLocation.create({
					data: {
						serial,
						serviceCodeId: sc.id,
						status: "VAN",
						currentRef: van.id,
					},
				})
				await db.stockMovement.create({
					data: {
						vanId: van.id,
						kind: "SERIAL",
						serviceCodeId: sc.id,
						qty: 1,
						serial,
						type: "ADJUST",
						byUserId: van.installerId as string,
					},
				})
				created++
			}
		}
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`synthetic opening stock: ${created} serials seeded`)
}

async function seedLimitTable() {
	const byCode = Object.fromEntries(
		(await db.serviceCode.findMany()).map((c) => [c.claroCode, c.id]),
	)
	let inserted = 0
	for (const r of LIMIT_TABLE_SEED) {
		const serviceCodeId = byCode[r.claroCode]
		if (!serviceCodeId) continue
		await db.limitTable.upsert({
			where: {
				bracketFt_serviceCodeId: { bracketFt: r.bracketFt, serviceCodeId },
			},
			update: { qty: r.qty },
			create: { bracketFt: r.bracketFt, serviceCodeId, qty: r.qty },
		})
		inserted++
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`limit table: ${inserted}/${LIMIT_TABLE_SEED.length} rows upserted`,
	)
}

async function seedInstallerSupervisor() {
	// jalfaro@ per discovery notes; unconfirmed — spec §15 flags this as pending Alex/IT.
	const email = "jalfaro@jafcom.net"
	const password = await hashPassword(TEMP_PASSWORD)
	const user = await db.user.upsert({
		where: { email },
		update: {},
		create: {
			email,
			name: "Installer Supervisor",
			role: "INSTALLER_SUPERVISOR",
		},
	})
	await db.account.upsert({
		where: { id: `seed-${email}` },
		update: {},
		create: {
			id: `seed-${email}`,
			userId: user.id,
			accountId: user.id,
			providerId: "credential",
			password,
		},
	})
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`installer supervisor: ${email} upserted (unconfirmed identity — flagged)`,
	)
}

// Synthetic serials that exercise the serial-repair loop for demos and a
// future e2e. Guarded by SEED_DEMO=1 so prod seeds never gain fake serials;
// idempotent (upsert by serial). References the Phase 0 Guaynabo warehouse and
// any serialized ServiceCode.
async function seedDemoSerials() {
	if (process.env.SEED_DEMO !== "1") return
	const wh = await db.warehouse.findFirst({
		where: { name: { contains: "Guaynabo" } },
		select: { id: true },
	})
	const code = await db.serviceCode.findFirst({
		where: { serialized: true },
		select: { id: true },
	})
	if (!wh || !code) {
		// biome-ignore lint/suspicious/noConsole: CLI seed output
		console.log(
			"demo serials skipped (no Guaynabo warehouse or serialized code)",
		)
		return
	}
	const demo: {
		serial: string
		status: "RETURNED" | "AWAITING_REPAIR" | "NEEDS_REVIEW"
		condition: "NEW" | "REFURBISHED"
	}[] = [
		{ serial: "SER-DEMO-1", status: "RETURNED", condition: "NEW" },
		{ serial: "SER-DEMO-2", status: "AWAITING_REPAIR", condition: "NEW" },
		{ serial: "SER-DEMO-3", status: "NEEDS_REVIEW", condition: "NEW" },
	]
	for (const d of demo) {
		await db.serialLocation.upsert({
			where: { serial: d.serial },
			update: {},
			create: {
				serial: d.serial,
				serviceCodeId: code.id,
				status: d.status,
				condition: d.condition,
				currentRef: wh.id,
				since: new Date(),
			},
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`demo serials: ${demo.length} upserted at Guaynabo (SEED_DEMO=1)`)
}

// Demo Claro supervisors (invented people, unroutable `.invalid` addresses),
// one per rule combination, so a demo can walk the packet gates. Guarded by
// SEED_DEMO=1 like the demo serials: the intake dropdown lists every active
// entry, and a real deployment's directory is entered on Admin → Claro
// supervisors. Idempotent: upsert on a stable id; an admin's edits survive.
const DEMO_CLARO_SUPERVISORS = [
	{
		id: "demo-claro-prefield-blueprint",
		name: "Marisol Quiñones (demo)",
		email: "marisol.quinones@claro-demo.invalid",
		requiresPrefield: true,
		requiresBlueprint: true,
	},
	{
		id: "demo-claro-prefield",
		name: "Héctor Villanueva (demo)",
		email: "hector.villanueva@claro-demo.invalid",
		requiresPrefield: true,
		requiresBlueprint: false,
	},
	{
		id: "demo-claro-plain",
		name: "Lucía Ortega (demo)",
		email: "lucia.ortega@claro-demo.invalid",
		requiresPrefield: false,
		requiresBlueprint: false,
	},
]

async function seedDemoClaroSupervisors() {
	if (process.env.SEED_DEMO !== "1") return
	for (const c of DEMO_CLARO_SUPERVISORS)
		await db.claroSupervisor.upsert({
			where: { id: c.id },
			update: {},
			create: c,
		})
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`demo Claro supervisors: ${DEMO_CLARO_SUPERVISORS.length} upserted (SEED_DEMO=1)`,
	)
}

// Links each JAF supervisor to the Claro supervisors they work with (the
// client's sheet, in claro-supervisor-links.ts). A Claro supervisor is found by
// email and created if missing; links are only ever added, so an admin's later
// edits on Admin → Claro supervisors survive a re-seed.
async function seedClaroSupervisorLinks() {
	let linked = 0
	for (const { jafEmail, claro } of CLARO_SUPERVISOR_LINKS) {
		const jaf = await db.user.findUnique({ where: { email: jafEmail } })
		if (!jaf) {
			// biome-ignore lint/suspicious/noConsole: CLI seed output
			console.warn(`claro links: no user ${jafEmail}, skipped`)
			continue
		}
		for (const c of claro) {
			const found = await db.claroSupervisor.findFirst({
				where: { email: c.email },
			})
			const id = found?.id ?? (await db.claroSupervisor.create({ data: c })).id
			await db.user.update({
				where: { id: jaf.id },
				data: { claroSupervisors: { connect: { id } } },
			})
			linked++
		}
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`claro supervisor links: ${linked} ensured`)
}

async function main() {
	// Fail before any write, not after 9 other steps have already committed:
	// the roster CSV is an out-of-band transfer (gitignored, real PII), and a
	// missing file would otherwise leave every other account seeded with the
	// shared temp password but zero installers — a state nothing stops the
	// deployer from continuing past.
	await fs.access(INSTALLER_ROSTER_CSV_PATH)
	await seedCatalog()
	await seedSupervisors()
	await seedBrigades()
	await seedClaroSupervisorLinks()
	await seedContractorAccounts(db)
	await seedWarehouses()
	await seedWarehouseStaff()
	await seedWarehouseBackups()
	await seedNeedsCodePlaceholders()
	await seedSerializedFlags()
	await seedInstallerSupervisor()
	await seedInstallers()
	await seedVansAndStock()
	await seedLimitTable()
	await seedDemoSerials()
	await seedDemoClaroSupervisors()
	await seedWarehouseStartingBalances(db)
}

main()
	.then(() => db.$disconnect())
	.catch((e) => {
		// biome-ignore lint/suspicious/noConsole: CLI seed error output
		console.error(e)
		return db.$disconnect().then(() => process.exit(1))
	})
