import fs from "node:fs/promises"
import path from "node:path"
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "better-auth/crypto"
import { generateClaroNoticePdf } from "../app/lib/pdf/claro-notice.server"
import { generateScheduleAccountsPdf } from "../app/lib/pdf/schedule-accounts.server"
import { generateWarehouseReceiptPdf } from "../app/lib/pdf/warehouse-receipt.server"
import { PrismaClient } from "../generated/prisma/client"

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

// 1x1 pixel, used as a stand-in signature image for demo records.
const SIGNATURE_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

// Smallest valid JPEG, used as a stand-in field photo for demo records.
const PLACEHOLDER_JPEG_BASE64 =
	"/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="

function daysAgo(n: number): Date {
	return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

function materials(a: number, b: number, c: number, codeIds: string[]) {
	return [
		{ serviceCodeId: codeIds[0], qty: a },
		{ serviceCodeId: codeIds[1], qty: b },
		{ serviceCodeId: codeIds[2], qty: c },
	].filter((m) => m.qty > 0)
}

async function main() {
	const password = await hashPassword("jaf2026!")

	const users = [
		{
			email: "supervisor@jafcom.net",
			name: "Supervisor",
			role: "SUPERVISOR" as const,
		},
		{ email: "crew@jafcom.net", name: "Crew", role: "CREW" as const },
		{
			email: "warehouse@jafcom.net",
			name: "Warehouse",
			role: "WAREHOUSE" as const,
		},
		{
			email: "finance@jafcom.net",
			name: "Finance",
			role: "FINANCE" as const,
		},
		{
			email: "comptroller@jafcom.net",
			name: "Comptroller",
			role: "COMPTROLLER" as const,
		},
		{ email: "admin@jafcom.net", name: "Admin", role: "ADMIN" as const },
	]

	for (const u of users) {
		const user = await db.user.upsert({
			where: { email: u.email },
			update: { name: u.name, role: u.role },
			create: { email: u.email, name: u.name, role: u.role },
		})
		await db.account.upsert({
			where: { id: `seed-${u.email}` },
			update: { password },
			create: {
				id: `seed-${u.email}`,
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password,
			},
		})
	}

	const supervisor = await db.user.findUniqueOrThrow({
		where: { email: "supervisor@jafcom.net" },
	})
	const crew = await db.user.findUniqueOrThrow({
		where: { email: "crew@jafcom.net" },
	})
	const warehouseUser = await db.user.findUniqueOrThrow({
		where: { email: "warehouse@jafcom.net" },
	})
	const finance = await db.user.findUniqueOrThrow({
		where: { email: "finance@jafcom.net" },
	})

	// 3 zone warehouses — names are placeholders; update before go-live (Open Item)
	const warehouseDefs = [
		{ name: "Warehouse Norte", zone: "Norte", location: "Zona Norte" },
		{ name: "Warehouse Centro", zone: "Centro", location: "Zona Centro" },
		{ name: "Warehouse Sur", zone: "Sur", location: "Zona Sur" },
	]
	for (const w of warehouseDefs) {
		await db.warehouse.upsert({
			where: { id: `seed-${w.zone}` },
			update: {},
			create: { id: `seed-${w.zone}`, ...w },
		})
	}
	const warehouses = await db.warehouse.findMany({
		where: { id: { in: warehouseDefs.map((w) => `seed-${w.zone}`) } },
		orderBy: { zone: "asc" },
	})

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
	const serviceCodes = await db.serviceCode.findMany({
		where: { claroCode: { in: codes.map((c) => c.claroCode) } },
		orderBy: { claroCode: "asc" },
	})
	const codeIds = serviceCodes.map((c) => c.id)
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [
			c.id,
			{
				id: c.id,
				claroCode: c.claroCode,
				name: c.name,
				unit: c.unit,
				unitPrice: Number(c.unitPrice),
			},
		]),
	)

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const receiptDir = path.join(uploadDir, "receipts")
	const claroDir = path.join(uploadDir, "claro-pdfs")
	const lcDir = path.join(uploadDir, "lc-requests")
	const photosDir = path.join(uploadDir, "photos")
	await fs.mkdir(receiptDir, { recursive: true })
	await fs.mkdir(claroDir, { recursive: true })
	await fs.mkdir(lcDir, { recursive: true })
	await fs.mkdir(photosDir, { recursive: true })

	function amountOf(items: { serviceCodeId: string; qty: number }[]) {
		return items.reduce(
			(sum, i) => sum + (codeMap[i.serviceCodeId]?.unitPrice ?? 0) * i.qty,
			0,
		)
	}

	type InvoiceDef = {
		controlNumber: string
		status:
			| "CREATED"
			| "PREPPED"
			| "SIGNED"
			| "FIELD_UPDATED"
			| "SUPERVISOR_APPROVED"
			| "CLARO_UPLOADED"
			| "LC_GENERATED"
		jobType: string
		jobAddressEstimated: string
		jobAddressActual?: string
		estimatedMaterials: { serviceCodeId: string; qty: number }[]
		warehouse?: (typeof warehouses)[number]
		materialsTaken?: { serviceCodeId: string; qty: number }[]
		materialsUsed?: { serviceCodeId: string; qty: number }[]
		fieldNotes?: string
		avisoNumber?: string
		claroNotes?: string
		poNumber?: string
		acceptanceNumber?: string
		advanceAmount?: number
		finalPaymentAmount?: number
		closed?: boolean
		createdDaysAgo: number
		hasPhoto?: boolean
	}

	const invoiceDefs: InvoiceDef[] = [
		{
			controlNumber: "JAF-2026-1001",
			status: "CREATED",
			jobType: "Pole Line Maintenance",
			jobAddressEstimated: "PR-2 KM 45.3, Aguadilla",
			estimatedMaterials: materials(30, 10, 0, codeIds),
			createdDaysAgo: 2,
		},
		{
			controlNumber: "JAF-2026-1002",
			status: "PREPPED",
			jobType: "Aerial Cable Removal",
			jobAddressEstimated: "PR-10 KM 12.7, Ponce",
			estimatedMaterials: materials(25, 0, 15, codeIds),
			createdDaysAgo: 9,
		},
		{
			controlNumber: "JAF-2026-1003",
			status: "SIGNED",
			jobType: "Guy Wire Installation",
			jobAddressEstimated: "PR-2 KM 88.1, Manatí",
			estimatedMaterials: materials(20, 5, 10, codeIds),
			warehouse: warehouses[1],
			materialsTaken: materials(20, 5, 10, codeIds),
			createdDaysAgo: 12,
		},
		{
			controlNumber: "JAF-2026-1004",
			status: "FIELD_UPDATED",
			jobType: "Pole Removal — Guy Wire Support",
			jobAddressEstimated: "PR-2 KM 63.4, Isabela",
			jobAddressActual: "PR-2 KM 63.6, Isabela",
			estimatedMaterials: materials(18, 6, 9, codeIds),
			warehouse: warehouses[0],
			materialsTaken: materials(18, 6, 9, codeIds),
			materialsUsed: materials(16, 6, 8, codeIds),
			fieldNotes:
				"Completed transfer and removed damaged guy wire. No access issues.",
			createdDaysAgo: 15,
			hasPhoto: true,
		},
		{
			controlNumber: "JAF-2026-1005",
			status: "SUPERVISOR_APPROVED",
			jobType: "Tree Trimming — Line Clearance",
			jobAddressEstimated: "PR-111 KM 5.2, San Sebastián",
			jobAddressActual: "PR-111 KM 5.2, San Sebastián",
			estimatedMaterials: materials(12, 0, 20, codeIds),
			warehouse: warehouses[2],
			materialsTaken: materials(12, 0, 20, codeIds),
			materialsUsed: materials(12, 0, 20, codeIds),
			fieldNotes: "Trimmed vegetation along span, plant clear of obstruction.",
			avisoNumber: "88410221",
			claroNotes: "Approved for Claro submission — work matches aviso scope.",
			createdDaysAgo: 18,
			hasPhoto: true,
		},
		{
			controlNumber: "JAF-2026-1006",
			status: "CLARO_UPLOADED",
			jobType: "Down Guy Removal",
			jobAddressEstimated: "PR-2 KM 101.5, Arecibo",
			jobAddressActual: "PR-2 KM 101.5, Arecibo",
			estimatedMaterials: materials(15, 0, 6, codeIds),
			warehouse: warehouses[1],
			materialsTaken: materials(15, 0, 6, codeIds),
			materialsUsed: materials(15, 0, 6, codeIds),
			fieldNotes: "Removed down guy, restored clearance to spec.",
			avisoNumber: "88410355",
			claroNotes: "Approved for Claro submission.",
			createdDaysAgo: 22,
			hasPhoto: true,
		},
		{
			controlNumber: "JAF-2026-1007",
			status: "LC_GENERATED",
			jobType: "Transfer Attach — Messenger Cable",
			jobAddressEstimated: "PR-2 KM 130.8, Hatillo",
			jobAddressActual: "PR-2 KM 130.8, Hatillo",
			estimatedMaterials: materials(40, 8, 0, codeIds),
			warehouse: warehouses[0],
			materialsTaken: materials(40, 8, 0, codeIds),
			materialsUsed: materials(40, 8, 0, codeIds),
			fieldNotes: "Transfer attach completed for messenger cable relocation.",
			avisoNumber: "88410489",
			claroNotes: "Approved for Claro submission.",
			poNumber: "4500911842",
			acceptanceNumber: "AC-2026-0041",
			advanceAmount: undefined, // computed as 80% of total below
			createdDaysAgo: 25,
			hasPhoto: true,
		},
		{
			controlNumber: "JAF-2026-1008",
			status: "LC_GENERATED",
			jobType: "Pole Removal — Transfer & Cable Removal",
			jobAddressEstimated: "PR-2 KM 142.3, Mayagüez",
			jobAddressActual: "PR-2 KM 142.3, Mayagüez",
			estimatedMaterials: materials(1210, 3, 40, codeIds),
			warehouse: warehouses[2],
			materialsTaken: materials(1210, 3, 40, codeIds),
			materialsUsed: materials(1210, 3, 40, codeIds),
			fieldNotes:
				"Pole and messenger cable removed per aviso scope. Closed out.",
			avisoNumber: "88410602",
			claroNotes: "Approved for Claro submission — final closeout.",
			poNumber: "4500912233",
			acceptanceNumber: "AC-2026-0058",
			closed: true,
			createdDaysAgo: 30,
			hasPhoto: true,
		},
	]

	for (const def of invoiceDefs) {
		const data: Record<string, unknown> = {
			jobType: def.jobType,
			jobAddressEstimated: def.jobAddressEstimated,
			estimatedMaterials: def.estimatedMaterials,
			assignedCrewIds: [crew.id],
			supervisorId: supervisor.id,
			status: def.status,
			createdAt: daysAgo(def.createdDaysAgo),
		}

		if (def.warehouse) {
			data.warehouseId = def.warehouse.id
			data.preppedAt = daysAgo(def.createdDaysAgo - 1)
			data.preppedById = warehouseUser.id
		}
		if (def.materialsTaken) {
			data.materialsTaken = def.materialsTaken
			data.releaseSignature = SIGNATURE_DATA_URL
			data.releasedById = warehouseUser.id
			data.releaseSignedAt = daysAgo(def.createdDaysAgo - 2)
			data.crewSignature = SIGNATURE_DATA_URL
			data.signedById = crew.id
			data.signedAt = daysAgo(def.createdDaysAgo - 2)
		}
		if (def.materialsUsed) {
			data.jobAddressActual = def.jobAddressActual
			data.materialsUsed = def.materialsUsed
			data.fieldNotes = def.fieldNotes
			data.completedAt = daysAgo(def.createdDaysAgo - 3)
		}
		if (def.avisoNumber) {
			data.avisoNumber = def.avisoNumber
			data.claroNotes = def.claroNotes
			data.supervisorApprovedAt = daysAgo(def.createdDaysAgo - 4)
		}

		const invoice = await db.jafInvoice.upsert({
			where: { controlNumber: def.controlNumber },
			update: data,
			create: { controlNumber: def.controlNumber, ...data },
		} as any)

		// Generated documents — deterministic paths so reruns overwrite in place.
		if (def.materialsTaken) {
			const receiptPath = path.join(
				receiptDir,
				`${def.controlNumber}-receipt.pdf`,
			)
			const pdf = await generateWarehouseReceiptPdf(
				{
					controlNumber: invoice.controlNumber,
					jobType: invoice.jobType,
					jobAddressEstimated: invoice.jobAddressEstimated,
					avisoNumber: invoice.avisoNumber,
					materialsTaken: def.materialsTaken,
					releaseSignature: SIGNATURE_DATA_URL,
					crewSignature: SIGNATURE_DATA_URL,
					signedAt: daysAgo(def.createdDaysAgo - 2),
				},
				serviceCodes.map((c) => ({
					id: c.id,
					claroCode: c.claroCode,
					name: c.name,
					unit: c.unit,
					unitPrice: Number(c.unitPrice),
				})),
				def.warehouse?.name ?? "",
			)
			await fs.writeFile(receiptPath, pdf)
			await db.jafInvoice.update({
				where: { id: invoice.id },
				data: { warehouseReceiptPath: receiptPath },
			})
		}

		if (def.avisoNumber && def.status !== "SUPERVISOR_APPROVED") {
			const claroPdfPath = path.join(claroDir, `${def.controlNumber}-claro.pdf`)
			const pdf = await generateClaroNoticePdf({
				avisoNumber: def.avisoNumber,
				jobType: def.jobType,
				jobAddress: def.jobAddressActual ?? def.jobAddressEstimated,
				assignedTo: crew.name,
				lineItems: (def.materialsUsed ?? []).map((m) => ({
					claroCode: codeMap[m.serviceCodeId]?.claroCode ?? "",
					name: codeMap[m.serviceCodeId]?.name ?? "",
					qty: m.qty,
					unit: codeMap[m.serviceCodeId]?.unit ?? "SR",
				})),
			})
			await fs.writeFile(claroPdfPath, pdf)
			await db.jafInvoice.update({
				where: { id: invoice.id },
				data: {
					claroPdfPath,
					claroUploadedAt: daysAgo(def.createdDaysAgo - 5),
				},
			})
		}

		if (def.status === "LC_GENERATED" && def.materialsUsed) {
			const total = amountOf(def.materialsUsed)
			const advanceAmount = Math.round(total * 0.8 * 100) / 100
			const finalPaymentAmount = Math.round((total - advanceAmount) * 100) / 100

			const lcRequestPdfPath = path.join(
				lcDir,
				`${def.controlNumber}-schedule.pdf`,
			)
			const pdf = await generateScheduleAccountsPdf({
				invoices: [
					{
						invoiceDate: daysAgo(def.createdDaysAgo - 6).toLocaleDateString(
							"en-US",
						),
						invoiceNumber: `M2026-${def.avisoNumber}`,
						debtor: "PRT/CLARO",
						poNumber: def.poNumber ?? "",
						amount: total,
					},
				],
			})
			await fs.writeFile(lcRequestPdfPath, pdf)

			const lcUpdate: Record<string, unknown> = {
				lcRequestPdfPath,
				lcGeneratedAt: daysAgo(def.createdDaysAgo - 6),
				lcApprovedById: finance.id,
				advanceReceivedAt: daysAgo(def.createdDaysAgo - 7),
				advanceAmount,
			}
			if (def.closed) {
				lcUpdate.finalPaymentReceivedAt = daysAgo(1)
				lcUpdate.finalPaymentAmount = finalPaymentAmount
				lcUpdate.receivableClosedAt = daysAgo(1)
				lcUpdate.receivableClosedById = finance.id
			}
			await db.jafInvoice.update({ where: { id: invoice.id }, data: lcUpdate })

			await db.poLink.deleteMany({ where: { docId: invoice.id } })
			await db.poLink.create({
				data: {
					docId: invoice.id,
					claroPONumber: def.poNumber ?? "",
					acceptanceNumber: def.acceptanceNumber,
					amount: total,
				},
			})
		}

		// Audit trail — one entry per stage this invoice has passed through.
		const STAGE_ORDER = [
			"CREATED",
			"PREPPED",
			"SIGNED",
			"FIELD_UPDATED",
			"SUPERVISOR_APPROVED",
			"CLARO_UPLOADED",
			"LC_GENERATED",
		] as const
		const reached = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(def.status) + 1)
		await db.auditTrail.deleteMany({ where: { docId: invoice.id } })
		await db.auditTrail.createMany({
			data: reached.map((stage, i) => ({
				docId: invoice.id,
				userId:
					stage === "PREPPED"
						? warehouseUser.id
						: stage === "SIGNED"
							? crew.id
							: stage === "SUPERVISOR_APPROVED" || stage === "CLARO_UPLOADED"
								? supervisor.id
								: stage === "LC_GENERATED"
									? finance.id
									: supervisor.id,
				action: i === 0 ? "DOC_CREATED" : "STATUS_CHANGED",
				diffJson:
					i === 0
						? { status: { before: null, after: stage } }
						: { status: { before: reached[i - 1], after: stage } },
				timestamp: daysAgo(def.createdDaysAgo - i),
			})),
		})

		// Photo — one placeholder field photo for invoices that reached field update.
		await db.photo.deleteMany({ where: { docId: invoice.id } })
		if (def.hasPhoto) {
			const photoDir = path.join(photosDir, invoice.id)
			await fs.mkdir(photoDir, { recursive: true })
			const photoPath = path.join(photoDir, "site-1.jpg")
			await fs.writeFile(
				photoPath,
				Buffer.from(PLACEHOLDER_JPEG_BASE64, "base64"),
			)
			await db.photo.create({
				data: {
					docId: invoice.id,
					uploadedById: crew.id,
					localPath: photoPath,
					takenAt: daysAgo(def.createdDaysAgo - 3),
				},
			})
		}
	}

	// Notifications — a few, mixed read/unread, so the bell isn't empty.
	await db.notification.deleteMany({ where: { docId: { not: null } } })
	const claroUploadedInvoice = await db.jafInvoice.findUnique({
		where: { controlNumber: "JAF-2026-1006" },
	})
	const fieldUpdatedInvoice = await db.jafInvoice.findUnique({
		where: { controlNumber: "JAF-2026-1004" },
	})
	const preppedInvoice = await db.jafInvoice.findUnique({
		where: { controlNumber: "JAF-2026-1002" },
	})
	if (claroUploadedInvoice) {
		await db.notification.create({
			data: {
				userId: finance.id,
				docId: claroUploadedInvoice.id,
				message: `Job ${claroUploadedInvoice.controlNumber} Claro work order uploaded. Ready for LC request.`,
				read: false,
			},
		})
	}
	if (fieldUpdatedInvoice) {
		await db.notification.create({
			data: {
				userId: supervisor.id,
				docId: fieldUpdatedInvoice.id,
				message: `Crew completed field work for ${fieldUpdatedInvoice.controlNumber}. Ready for your approval.`,
				read: false,
			},
		})
	}
	if (preppedInvoice) {
		await db.notification.create({
			data: {
				userId: crew.id,
				docId: preppedInvoice.id,
				message: `Materials prepped for ${preppedInvoice.controlNumber}, ready for pickup.`,
				read: true,
			},
		})
	}

	// biome-ignore lint/suspicious/noConsole: seed script intentionally logs completion
	console.log("Seed complete")
}

main()
	// biome-ignore lint/suspicious/noConsole: seed script uses console for error reporting
	.catch(console.error)
	.finally(() => db.$disconnect())
