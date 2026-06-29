import { hashPassword } from "better-auth/crypto"
import { PrismaClient } from "../generated/prisma/client"

// TODO: Prisma 7 requires a driver adapter (e.g. @prisma/adapter-pg or @prisma/adapter-neon).
// Owner needs to confirm which adapter to use before this runs.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error adapter not yet configured — see above TODO
const db = new PrismaClient()

async function main() {
	const password = await hashPassword("jaf2026!")

	const users = [
		{
			email: "supervisor@jaf.com",
			name: "Supervisor Test",
			role: "SUPERVISOR" as const,
		},
		{ email: "crew@jaf.com", name: "Crew Test", role: "CREW" as const },
		{
			email: "idalia@jaf.com",
			name: "Idalia (Warehouse)",
			role: "WAREHOUSE" as const,
		},
		{
			email: "lissette@jaf.com",
			name: "Lissette (Finance)",
			role: "FINANCE" as const,
		},
		{ email: "admin@jaf.com", name: "Admin", role: "ADMIN" as const },
	]

	for (const u of users) {
		const user = await db.user.upsert({
			where: { email: u.email },
			update: {},
			create: { email: u.email, name: u.name, role: u.role },
		})
		await db.account.upsert({
			where: { id: `seed-${u.email}` },
			update: {},
			create: {
				id: `seed-${u.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}
	// 3 zone warehouses — names are placeholders; update before go-live (Open Item)
	const warehouses = [
		{ name: "Warehouse Norte", zone: "Norte", location: "Zona Norte" },
		{ name: "Warehouse Centro", zone: "Centro", location: "Zona Centro" },
		{ name: "Warehouse Sur", zone: "Sur", location: "Zona Sur" },
	]
	for (const w of warehouses) {
		await db.warehouse.upsert({
			where: { id: `seed-${w.zone}` },
			update: {},
			create: { id: `seed-${w.zone}`, ...w },
		})
	}

	// Sample Claro service codes from contract
	const codes = [
		{
			claroCode: "34006428",
			name: "REMOCION MENSAJERO",
			unit: "SR",
			unitPrice: 0.36,
			accountCode: "6200",
			dept: "PWOR",
		},
		{
			claroCode: "34006429",
			name: "INSTALACION MENSAJERO",
			unit: "SR",
			unitPrice: 0.52,
			accountCode: "6200",
			dept: "PWOR",
		},
		{
			claroCode: "34006430",
			name: "MANTENIMIENTO GENERAL",
			unit: "SR",
			unitPrice: 0.44,
			accountCode: "6210",
			dept: "PWOR",
		},
	]

	for (const c of codes) {
		await db.serviceCode.upsert({
			where: { claroCode: c.claroCode },
			update: {},
			create: { ...c },
		})
	}

	// biome-ignore lint/suspicious/noConsole: seed script intentionally logs completion
	console.log("Seed complete")
}

main()
	// biome-ignore lint/suspicious/noConsole: seed script uses console for error reporting
	.catch(console.error)
	.finally(() => db.$disconnect())
