import fs from "node:fs/promises"
import path from "node:path"
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "better-auth/crypto"
import {
	BRIGADE_SEED,
	LEGACY_DEMO_CODES,
	LIMIT_TABLE_PLACEHOLDER_CODES,
	LIMIT_TABLE_SEED,
	parseCatalogCsv,
	parseInstallerRosterCsv,
	SERIALIZED_PREFIXES,
	SUPERVISOR_SEED,
	toServiceCodeData,
	WAREHOUSE_BACKUP_SEED,
	WAREHOUSE_SEED,
	WAREHOUSE_STAFF_SEED,
} from "../app/lib/catalog-import"
import { PrismaClient } from "../generated/prisma/client"

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const CSV_PATH = path.resolve(
	process.cwd(),
	"docs/JAF_Service_Catalog_seed.csv",
)
const BATCH = 100
if (!process.env.SEED_TEMP_PASSWORD) {
	throw new Error(
		"SEED_TEMP_PASSWORD is required — no default credential password is shipped for seeded accounts.",
	)
}
const TEMP_PASSWORD = process.env.SEED_TEMP_PASSWORD

async function seedCatalog() {
	const rows = parseCatalogCsv(await fs.readFile(CSV_PATH, "utf8"))
	const data = rows.map(toServiceCodeData)
	let inserted = 0
	for (let i = 0; i < data.length; i += BATCH) {
		const res = await db.serviceCode.createMany({
			data: data.slice(i, i + BATCH),
			skipDuplicates: true,
		})
		inserted += res.count
	}
	const deactivated = await db.serviceCode.updateMany({
		where: { claroCode: { in: LEGACY_DEMO_CODES } },
		data: { active: false },
	})
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`catalog: ${rows.length} rows read, ${inserted} inserted, ${deactivated.count} legacy demo codes deactivated`,
	)
}

async function seedSupervisors() {
	const password = await hashPassword(TEMP_PASSWORD)
	for (const s of SUPERVISOR_SEED) {
		const user = await db.user.upsert({
			where: { email: s.email },
			update: { name: s.name, phone: s.phone },
			create: {
				email: s.email,
				name: s.name,
				phone: s.phone,
				role: "SUPERVISOR",
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
		`supervisors: ${SUPERVISOR_SEED.length} upserted (password set via SEED_TEMP_PASSWORD)`,
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
			code: b.code,
			area: b.area,
			supervisorId: byEmail[b.supervisorEmail] ?? null,
			leadName: b.leadName,
			phone: b.phone,
			active: true,
		}
		const existing = await db.brigade.findFirst({ where: { name: b.name } })
		if (existing) await db.brigade.update({ where: { id: existing.id }, data })
		else
			await db.brigade.create({
				data: { name: b.name, memberIds: [], ...data },
			})
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
			update: {},
			create: {
				claroCode,
				name,
				kind: "MATERIAL",
				unitPrice: "0",
				active: true,
			},
		})
	}
}

async function seedSerializedFlags() {
	for (const { prefix, claroCode, name } of SERIALIZED_PREFIXES) {
		await db.serviceCode.upsert({
			where: { claroCode },
			update: { serialized: true, serialPrefix: prefix },
			create: {
				claroCode,
				name,
				kind: "MATERIAL",
				unitPrice: "0",
				active: true,
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
		`installers: ${rows.length} upserted (password set via SEED_TEMP_PASSWORD)`,
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
		// rather than re-writing its VanMovement, which would otherwise duplicate rows
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
				await db.vanMovement.create({
					data: {
						vanId: van.id,
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

async function main() {
	await seedCatalog()
	await seedSupervisors()
	await seedBrigades()
	await seedWarehouses()
	await seedWarehouseStaff()
	await seedWarehouseBackups()
	await seedNeedsCodePlaceholders()
	await seedSerializedFlags()
	await seedInstallerSupervisor()
	await seedInstallers()
	await seedVansAndStock()
	await seedLimitTable()
}

main()
	.then(() => db.$disconnect())
	.catch((e) => {
		// biome-ignore lint/suspicious/noConsole: CLI seed error output
		console.error(e)
		return db.$disconnect().then(() => process.exit(1))
	})
