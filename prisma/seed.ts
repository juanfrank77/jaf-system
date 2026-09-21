import fs from "node:fs/promises"
import path from "node:path"
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "better-auth/crypto"
import {
	BRIGADE_SEED,
	LEGACY_DEMO_CODES,
	parseCatalogCsv,
	SUPERVISOR_SEED,
	toServiceCodeData,
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
const TEMP_PASSWORD = process.env.SEED_TEMP_PASSWORD || "jaf2026!"

/** Dev/pilot-only demo logins, one per non-supervisor role — not real staff. */
const DEMO_ROLE_SEED = [
	{ email: "admin@jafcomm.local", name: "Demo Admin", role: "ADMIN" },
	{ email: "finance@jafcomm.local", name: "Demo Finance", role: "FINANCE" },
	{
		email: "warehouse@jafcomm.local",
		name: "Demo Warehouse",
		role: "WAREHOUSE",
	},
	{ email: "crew@jafcomm.local", name: "Demo Crew", role: "CREW" },
] as const

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
		`supervisors: ${SUPERVISOR_SEED.length} upserted (temporary password: ${TEMP_PASSWORD})`,
	)
}

async function seedDemoRoleAccounts() {
	const password = await hashPassword(TEMP_PASSWORD)
	for (const d of DEMO_ROLE_SEED) {
		const user = await db.user.upsert({
			where: { email: d.email },
			update: { name: d.name, role: d.role },
			create: {
				email: d.email,
				name: d.name,
				role: d.role,
			},
		})
		await db.account.upsert({
			where: { id: `seed-${d.email}` },
			update: {},
			create: {
				id: `seed-${d.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(
		`demo role accounts: ${DEMO_ROLE_SEED.length} upserted (temporary password: ${TEMP_PASSWORD})`,
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
	const warehouses = [
		{ name: "Main Warehouse", zone: "Central", active: true },
		{ name: "North Depot", zone: "Northern Zone", active: true },
		{ name: "South Depot", zone: "Southern Zone", active: true },
	]

	for (const w of warehouses) {
		const existing = await db.warehouse.findFirst({ where: { name: w.name } })
		if (existing) {
			await db.warehouse.update({
				where: { id: existing.id },
				data: { zone: w.zone, active: w.active },
			})
		} else {
			await db.warehouse.create({ data: w })
		}
	}
	// biome-ignore lint/suspicious/noConsole: CLI seed output
	console.log(`warehouses: ${warehouses.length} upserted`)
}

async function main() {
	await seedCatalog()
	await seedSupervisors()
	await seedDemoRoleAccounts()
	await seedBrigades()
	await seedWarehouses()
}

main()
	.then(() => db.$disconnect())
	.catch((e) => {
		// biome-ignore lint/suspicious/noConsole: CLI seed error output
		console.error(e)
		return db.$disconnect().then(() => process.exit(1))
	})
