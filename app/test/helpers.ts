import { CONTRACTOR_SHARE_PERCENT } from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { truncateCents } from "~/lib/utils"

/**
 * Find-or-create a `ServiceCode` by its Claro code, returning the row.
 *
 * Warehouse rows key material by `serviceCodeId` (a `ServiceCode.id` cuid),
 * never a raw Claro string — so tests resolve a real row first and pass
 * `row.id`. `upsert` (rather than `create`) keeps the helper safe to call
 * from many server-test files sharing one `DATABASE_URL` without tripping
 * the `claroCode` unique constraint.
 */
export async function seedServiceCode(
	claroCode: string,
	overrides: {
		name?: string
		unitPrice?: number
		serialized?: boolean
		serialPrefix?: string | null
		reparadoCode?: string | null
		ownership?: "CLARO_CONSIGNED" | "JAF_PURCHASED" | "UNKNOWN"
	} = {},
) {
	return db.serviceCode.upsert({
		where: { claroCode },
		update: {},
		create: {
			claroCode,
			name: overrides.name ?? `Test ${claroCode}`,
			unitPrice: overrides.unitPrice ?? 0,
			serialized: overrides.serialized ?? false,
			serialPrefix: overrides.serialPrefix ?? null,
			reparadoCode: overrides.reparadoCode ?? null,
			ownership: overrides.ownership ?? "UNKNOWN",
		},
	})
}

/** A unique token for a test file run — server tests share one (Neon dev) DB. */
export function runToken(prefix = "T") {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * Tracks rows created by a test file and deletes them in `afterAll`, so the
 * shared Neon dev database (also the demo DB) is not polluted with fixtures.
 * Deletion runs children → parents to respect FKs (StockMovement→Warehouse is
 * `onDelete: Restrict`; Notification→User is restricted too).
 */
export function makeTracker() {
	const b = {
		stockMovement: [] as string[],
		serialLocation: [] as string[],
		repairIntake: [] as string[],
		repairBatch: [] as string[],
		stockSnapshot: [] as string[],
		stockDelivery: [] as string[],
		notification: [] as string[],
		warehouseAssignment: [] as string[],
		warehouse: [] as string[],
		user: [] as string[],
		serviceCode: [] as string[],
		jafInvoice: [] as string[],
		bankSchedule: [] as string[],
		auditTrail: [] as string[],
		paymentRecord: [] as string[],
		claroPo: [] as string[],
		payrollRun: [] as string[],
		payrollRunAccount: [] as string[],
		contractorAccount: [] as string[],
		brigade: [] as string[],
		installCompletion: [] as string[],
		van: [] as string[],
		ewitInvoice: [] as string[],
		ewitBatch: [] as string[],
		installerPayment: [] as string[],
		sentReport: [] as string[],
	}
	function track<M extends keyof typeof b, R extends { id: string }>(
		model: M,
		row: R,
	): R {
		b[model].push(row.id)
		return row
	}
	async function cleanup() {
		// Tables with a warehouseId FK (onDelete: Restrict) are cleared by
		// warehouseId, not just tracked id — services create extra rows (e.g.
		// DISPOSITION movements) the test never sees, and any leftover would
		// block the warehouse delete.
		const whFilter = (idList: string[]) =>
			b.warehouse.length
				? { OR: [{ id: { in: idList } }, { warehouseId: { in: b.warehouse } }] }
				: { id: { in: idList } }
		if (b.stockMovement.length || b.warehouse.length)
			await db.stockMovement.deleteMany({ where: whFilter(b.stockMovement) })
		if (b.serialLocation.length)
			await db.serialLocation.deleteMany({
				where: { id: { in: b.serialLocation } },
			})
		if (b.repairIntake.length || b.warehouse.length)
			await db.repairIntake.deleteMany({ where: whFilter(b.repairIntake) })
		if (b.repairBatch.length || b.warehouse.length)
			await db.repairBatch.deleteMany({ where: whFilter(b.repairBatch) })
		if (b.stockSnapshot.length || b.warehouse.length)
			await db.stockSnapshot.deleteMany({ where: whFilter(b.stockSnapshot) })
		if (b.stockDelivery.length || b.warehouse.length)
			await db.stockDelivery.deleteMany({ where: whFilter(b.stockDelivery) })
		// Also remove service-created notifications addressed to tracked users.
		if (b.notification.length || b.user.length)
			await db.notification.deleteMany({
				where: {
					OR: [{ id: { in: b.notification } }, { userId: { in: b.user } }],
				},
			})
		// AdviceLine→ClaroInvoice and PaymentAdvice→User are FK'd.
		if (b.jafInvoice.length || b.user.length) {
			await db.adviceLine.deleteMany({
				where: { invoice: { docId: { in: b.jafInvoice } } },
			})
			await db.paymentAdvice.deleteMany({
				where: { uploadedById: { in: b.user } },
			})
		}
		// ClaroInvoice→ClaroPo/JafInvoice/User are FK'd: invoices go before POs.
		if (b.jafInvoice.length || b.user.length) {
			await db.claroInvoice.deleteMany({
				where: {
					OR: [{ docId: { in: b.jafInvoice } }, { madeById: { in: b.user } }],
				},
			})
		}
		// ClaroPo→JafInvoice/User are FK'd: the PO rows go first.
		if (b.claroPo.length || b.jafInvoice.length || b.user.length) {
			await db.claroPo.deleteMany({
				where: {
					OR: [
						{ id: { in: b.claroPo } },
						{ docId: { in: b.jafInvoice } },
						{ uploadedById: { in: b.user } },
					],
				},
			})
			await db.poLink.deleteMany({ where: { docId: { in: b.jafInvoice } } })
		}
		// AuditTrail→JafInvoice is FK'd, and JafInvoice→Warehouse/User are FK'd, so
		// both must go before warehouse/user cleanup below.
		if (b.auditTrail.length || b.jafInvoice.length)
			await db.auditTrail.deleteMany({
				where: {
					OR: [{ id: { in: b.auditTrail } }, { docId: { in: b.jafInvoice } }],
				},
			})
		// PaymentRecord→JafInvoice is FK'd, so it goes before the invoice rows below.
		if (b.paymentRecord.length || b.jafInvoice.length)
			await db.paymentRecord.deleteMany({
				where: {
					OR: [
						{ id: { in: b.paymentRecord } },
						{ jobId: { in: b.jafInvoice } },
					],
				},
			})
		if (b.jafInvoice.length)
			await db.jafInvoice.deleteMany({ where: { id: { in: b.jafInvoice } } })
		if (b.bankSchedule.length)
			await db.bankSchedule.deleteMany({
				where: { id: { in: b.bankSchedule } },
			})
		// Arm A parents: JafInvoice→PayrollRun/ContractorAccount/Brigade are
		// nullable FKs with NoAction referential action, so the invoice rows must
		// already be gone (above) before these can be deleted. Each of these in
		// turn FKs to `user` (PayrollRun.generatedById/paidById/reversedById,
		// Brigade.supervisorId), so they must go before `user` cleanup below.
		if (b.payrollRun.length)
			await db.payrollRun.deleteMany({ where: { id: { in: b.payrollRun } } })
		if (b.payrollRunAccount.length)
			await db.payrollRunAccount.deleteMany({
				where: { id: { in: b.payrollRunAccount } },
			})
		if (b.contractorAccount.length)
			await db.contractorAccount.deleteMany({
				where: { id: { in: b.contractorAccount } },
			})
		if (b.brigade.length)
			await db.brigade.deleteMany({ where: { id: { in: b.brigade } } })
		// Carmen's installer loop: completions point at invoices and payments, those
		// at batches and users, so they go in that order, before the users.
		if (b.installCompletion.length || b.user.length)
			await db.installCompletion.deleteMany({
				where: {
					OR: [
						{ id: { in: b.installCompletion } },
						{ installerId: { in: b.user } },
					],
				},
			})
		if (b.ewitInvoice.length || b.user.length)
			await db.ewitInvoice.deleteMany({
				where: {
					OR: [{ id: { in: b.ewitInvoice } }, { createdById: { in: b.user } }],
				},
			})
		if (b.ewitBatch.length || b.user.length)
			await db.ewitBatch.deleteMany({
				where: {
					OR: [{ id: { in: b.ewitBatch } }, { createdById: { in: b.user } }],
				},
			})
		if (b.installerPayment.length || b.user.length)
			await db.installerPayment.deleteMany({
				where: {
					OR: [
						{ id: { in: b.installerPayment } },
						{ installerId: { in: b.user } },
						{ paidById: { in: b.user } },
					],
				},
			})
		if (b.sentReport.length || b.user.length)
			await db.sentReport.deleteMany({
				where: {
					OR: [
						{ id: { in: b.sentReport } },
						{ fromId: { in: b.user } },
						{ toId: { in: b.user } },
					],
				},
			})
		if (b.van.length) await db.van.deleteMany({ where: { id: { in: b.van } } })
		if (b.warehouseAssignment.length)
			await db.warehouseAssignment.deleteMany({
				where: { id: { in: b.warehouseAssignment } },
			})
		if (b.warehouse.length)
			await db.warehouse.deleteMany({ where: { id: { in: b.warehouse } } })
		if (b.user.length) {
			// `sendPayrollRun` and the last tick fan a Notification out to every active FINANCE
			// user in the database, so a sibling test file running in parallel
			// against the shared dev DB can insert one for our tracked users
			// *after* the notification sweep above and before this delete. Re-clear
			// and retry to absorb that window instead of failing the whole suite.
			for (let attempt = 0; ; attempt++) {
				try {
					await db.user.deleteMany({ where: { id: { in: b.user } } })
					break
				} catch (err) {
					if (attempt >= 2) throw err
					await db.notification.deleteMany({
						where: { userId: { in: b.user } },
					})
				}
			}
		}
		// serviceCodeId is a plain column (no DB FK), so ServiceCode rows can be
		// removed last, order-independent.
		if (b.serviceCode.length)
			await db.serviceCode.deleteMany({ where: { id: { in: b.serviceCode } } })
	}
	return { track, cleanup }
}

/** Create a fresh warehouse for a test (unique name). */
export async function seedWarehouse(name?: string) {
	return db.warehouse.create({
		data: { name: name ?? runToken("WH"), zone: "Z" },
	})
}

/** Create a user with a unique email. */
export async function seedUser(opts: { role?: string; name?: string } = {}) {
	return db.user.create({
		data: {
			email: `${runToken("u")}@x.test`,
			name: opts.name ?? "Test User",
			role: (opts.role ?? "WAREHOUSE") as
				| "WAREHOUSE"
				| "ADMIN"
				| "SUPERVISOR"
				| "CREW"
				| "FINANCE"
				| "COMPTROLLER"
				| "INSTALLER"
				| "INSTALLER_SUPERVISOR",
		},
	})
}

/**
 * Create/refresh a ServiceCode (material) with optional dual-UOM fields.
 * Defaults to a per-run-unique claroCode so tests never mutate a real catalog
 * row. Returns the row — key movements/serials by its `.id`, never the Claro
 * string.
 */
export async function seedMaterial(
	opts: {
		claroCode?: string
		name?: string
		unitPrice?: number
		countUnit?: string | null
		stockUnit?: string | null
		conversionFactor?: number | null
		serialized?: boolean
	} = {},
) {
	const claroCode = opts.claroCode ?? runToken("MAT")
	const fields = {
		name: opts.name ?? `Test ${claroCode}`,
		unitPrice: opts.unitPrice ?? 0,
		countUnit: opts.countUnit ?? null,
		stockUnit: opts.stockUnit ?? null,
		conversionFactor: opts.conversionFactor ?? null,
		serialized: opts.serialized ?? false,
	}
	return db.serviceCode.upsert({
		where: { claroCode },
		update: fields,
		create: { claroCode, ...fields },
	})
}

/** Create an active Brigade with a unique code. */
export async function seedBrigade(
	overrides: { name?: string; code?: string; area?: string } = {},
) {
	const code = overrides.code ?? runToken("BRI")
	return db.brigade.create({
		data: {
			name: overrides.name ?? `Test Brigade ${code}`,
			code,
			area: overrides.area ?? "METRO",
			memberIds: [],
			active: true,
		},
	})
}

/** Create a ContractorAccount, optionally linked to a Brigade. */
export async function seedContractorAccount(
	overrides: {
		code?: string
		label?: string
		brigadeId?: string
		active?: boolean
	} = {},
) {
	const code = overrides.code ?? runToken("ACC")
	return db.contractorAccount.create({
		data: {
			code,
			label: overrides.label ?? `Test Contractor ${code}`,
			brigadeId: overrides.brigadeId ?? null,
			active: overrides.active ?? true,
		},
	})
}

/**
 * Create a JafInvoice already swept into a PayrollRun, with its Arm A payment
 * figures frozen — i.e. the state `generateRun` leaves behind.
 *
 * Loader/viewer tests should use this rather than calling `generateRun`
 * directly: the sweep is a GLOBAL operation over every Arm-A-open job in the
 * shared dev DB, so calling it from more than one test file makes them race
 * for the same candidate pool and steal each other's fixtures. Only
 * `payroll-run.server.test.ts` — the single file that tests the sweep itself —
 * calls it.
 */
export async function seedSweptInvoice(
	opts: {
		generatedById: string
		contractorAccountId: string
		contractorAccountCode?: string
		runLabel?: string
		grossPayable?: number
		retentionAmount?: number
		netPayable?: number
		/** A draft is Lissette's alone; the default run has been sent to Carmen. */
		draft?: boolean
	} = { generatedById: "", contractorAccountId: "" },
) {
	const run = await db.payrollRun.create({
		data: {
			label: opts.runLabel ?? runToken("RUN"),
			generatedById: opts.generatedById,
			...(opts.draft
				? {}
				: { sentAt: new Date(), sentById: opts.generatedById }),
		},
	})
	const gross = opts.grossPayable ?? 0
	const retention = opts.retentionAmount ?? 0
	const invoice = await seedFinanceableInvoice({
		contractorAccountId: opts.contractorAccountId,
		payrollRunId: run.id,
	})
	// Build a minimal contractorShareLines consistent with the frozen totals
	// so buildJournalBlocks (which now reads shareLines, not the frozen
	// total columns) has per-line detail to render.
	const sharePercent = CONTRACTOR_SHARE_PERCENT
	await db.jafInvoice.update({
		where: { id: invoice.id },
		data: {
			grossPayable: gross,
			retentionAmount: retention,
			netPayable: opts.netPayable ?? 0,
			contractorShareLines: [
				{
					serviceCodeId: "test-sc",
					claroCode: "TEST-LINE",
					name: "Test Service Line",
					qty: 1,
					unitPrice: gross / 1,
					lineAmount: gross,
					gross,
					sharePercent,
					net: truncateCents(gross * sharePercent),
					retention: truncateCents(gross * sharePercent * 0.1),
					adjNet: truncateCents(gross * sharePercent * 0.9),
				},
			] as never,
		},
	})
	return { run, invoice }
}

/**
 * Create a JafInvoice shaped like a real job that just landed in L1 —
 * released to finance, not yet Arm-A-closed, with resolvable invoice lines.
 *
 * `supervisorId` is a required FK on JafInvoice, so the fixture creates its own
 * supervisor when not given one. Pass a caller-created (and caller-tracked) user
 * to keep that row out of the shared dev DB's leftovers.
 */
export async function seedFinanceableInvoice(
	overrides: {
		status?: string
		supervisorId?: string
		contractorAccountId?: string | null
		contractorAccountCode?: string | null
		jafInvoiceLines?: {
			serviceCodeId: string
			claroCode: string
			name: string
			unit: string
			qty: number
			unitPrice: number
			lineAmount: number
		}[]
		releasedToFinanceAt?: Date | null
		avisoNumber?: string | null
		avisoDocPath?: string | null
		payablesClosedAt?: Date | null
		payrollRunId?: string | null
		pbccRequestSentAt?: Date | null
		/** Bank-funded: sets advanceReceivedAt and advanceAmount. */
		funded?: boolean
	} = {},
) {
	const supervisorId =
		overrides.supervisorId ?? (await seedUser({ role: "SUPERVISOR" })).id
	return db.jafInvoice.create({
		data: {
			controlNumber: runToken("JAF"),
			status: (overrides.status ?? "SUPERVISOR_APPROVED") as never,
			jobType: "INSTALL",
			jobAddressEstimated: "123 Test St",
			estimatedMaterials: [],
			assignedCrewIds: [],
			supervisorId,
			releasedToFinanceAt:
				overrides.releasedToFinanceAt === undefined
					? new Date()
					: overrides.releasedToFinanceAt,
			avisoNumber:
				overrides.avisoNumber === undefined
					? "10353961"
					: overrides.avisoNumber,
			avisoDocPath:
				overrides.avisoDocPath === undefined
					? "aviso-docs/test-aviso.pdf"
					: overrides.avisoDocPath,
			jafInvoiceLines: (overrides.jafInvoiceLines ?? []) as never,
			contractorAccountId: overrides.contractorAccountId ?? null,
			contractorAccountCode: overrides.contractorAccountCode ?? null,
			payablesClosedAt: overrides.payablesClosedAt ?? null,
			payrollRunId: overrides.payrollRunId ?? null,
			pbccRequestSentAt:
				overrides.pbccRequestSentAt === undefined
					? new Date()
					: overrides.pbccRequestSentAt,
			advanceReceivedAt: overrides.funded ? new Date() : null,
			advanceAmount: overrides.funded ? 80 : null,
		},
	})
}

/** An installer with a profile (Emp #) and a van, ready to submit completions. */
export async function seedInstaller(
	opts: { name?: string; jafNumber?: string } = {},
) {
	const user = await seedUser({ role: "INSTALLER", name: opts.name })
	const token = runToken("INS")
	await db.installerProfile.create({
		data: {
			userId: user.id,
			jafNumber: opts.jafNumber ?? "1808",
			toaNumber: token,
		},
	})
	const van = await db.van.create({
		data: { name: `Van ${token}`, installerId: user.id },
	})
	return { user, van }
}

/** A submitted installer completion (the warranty doc) for an order #. */
export async function seedCompletion(opts: {
	installerId: string
	vanId: string
	orderNo: string
	installedAt?: Date
	photo?: boolean
}) {
	return db.installCompletion.create({
		data: {
			idempotencyKey: runToken("IDK"),
			claroOrderNo: opts.orderNo,
			installerId: opts.installerId,
			vanId: opts.vanId,
			status: "SUBMITTED",
			address: "Test address",
			installedAt: opts.installedAt ?? new Date(),
			submittedAt: opts.installedAt ?? new Date(),
			serialInstalled: `ALCLED${opts.orderNo}`,
			formPhotoPath:
				opts.photo === false
					? null
					: `/tmp/uploads/completions/${opts.orderNo}.jpg`,
		},
	})
}
