import fs from "node:fs/promises"
import path from "node:path"
import type { PaymentRequestStatus } from "../../generated/prisma/client"
import { db } from "./db.server"
import { generateInstallCompletionPdf } from "./pdf/install-completion.server"
import { nextSerialState } from "./van-inventory-v3"

type CompletionInput = {
	idempotencyKey: string
	claroOrderNo: string
	installerId: string
	vanId: string
	address: string
	addressEditLog?: unknown
	gpsLat?: number
	gpsLng?: number
	dropFt?: number
	accessories: { serviceCodeId: string; prefilledQty: number; qty: number }[]
	groundRod: boolean
	coaxFt?: number
	serialInstalled?: string
	serialUnreadable: boolean
	modelResolved?: string
	formPhotoPath?: string
	labelPhotoPath?: string
	extraPhotoPaths?: string[]
	sigInstaller?: string
	installedAt: Date
}

function computeMissing(i: CompletionInput): string[] {
	const missing: string[] = []
	if (!i.serialInstalled && !i.serialUnreadable) missing.push("serial")
	if (i.serialUnreadable) missing.push("serial")
	if (!i.formPhotoPath) missing.push("formPhoto")
	if (!i.sigInstaller) missing.push("signature")
	return missing
}

export async function submitCompletion(
	i: CompletionInput,
	actor: { id: string },
): Promise<{
	completionId: string
	paymentRequestId: string
	status: PaymentRequestStatus
}> {
	const existing = await db.installCompletion.findUnique({
		where: { idempotencyKey: i.idempotencyKey },
	})
	if (existing) {
		// The completion and its PaymentRequest are created together in the
		// transaction below, so once `existing` is found here the PaymentRequest
		// is guaranteed to exist too.
		const pr = await db.paymentRequest.findFirstOrThrow({
			where: { completionId: existing.id },
		})
		return {
			completionId: existing.id,
			paymentRequestId: pr.id,
			status: pr.status,
		}
	}

	// Serial availability: authoritative check against SerialLocation (Review Focus: occupied serial).
	let serialNotOnVan = false
	if (i.serialInstalled) {
		const loc = await db.serialLocation.findUnique({
			where: { serial: i.serialInstalled },
		})
		serialNotOnVan = !(
			loc &&
			loc.status === "VAN" &&
			loc.currentRef === i.vanId
		)
	}

	const missing = computeMissing(i)
	const status: PaymentRequestStatus =
		missing.length > 0 ? "INCOMPLETE" : "READY"

	let completionId: string
	let paymentRequestId: string
	let paymentRequestStatus: PaymentRequestStatus
	try {
		const result = await db.$transaction(async (tx) => {
			const completion = await tx.installCompletion.create({
				data: {
					idempotencyKey: i.idempotencyKey,
					claroOrderNo: i.claroOrderNo,
					installerId: i.installerId,
					vanId: i.vanId,
					status: "SUBMITTED",
					address: i.address,
					addressEditLog: i.addressEditLog as never,
					gpsLat: i.gpsLat,
					gpsLng: i.gpsLng,
					dropFt: i.dropFt,
					accessories: i.accessories as never,
					groundRod: i.groundRod,
					coaxFt: i.coaxFt,
					serialInstalled: i.serialInstalled,
					serialUnreadable: i.serialUnreadable,
					serialNotOnVan,
					modelResolved: i.modelResolved,
					formPhotoPath: i.formPhotoPath,
					labelPhotoPath: i.labelPhotoPath,
					extraPhotoPaths: i.extraPhotoPaths ?? [],
					sigInstaller: i.sigInstaller,
					sigInstallerAt: i.sigInstaller ? new Date() : null,
					submittedAt: new Date(),
					installedAt: i.installedAt,
				},
			})

			// Serialized unit: INSTALL movement + authoritative SerialLocation → INSTALLED (only when it was on the van).
			if (i.serialInstalled && !serialNotOnVan) {
				const loc = await tx.serialLocation.findUnique({
					where: { serial: i.serialInstalled },
				})
				const to = nextSerialState(loc?.status ?? null, "INSTALL")
				await tx.serialLocation.update({
					where: { serial: i.serialInstalled },
					data: { status: to, currentRef: completion.id, since: new Date() },
				})
				await tx.vanMovement.create({
					data: {
						vanId: i.vanId,
						serviceCodeId: loc?.serviceCodeId ?? "",
						qty: -1,
						serial: i.serialInstalled,
						type: "INSTALL",
						refCompletionId: completion.id,
						byUserId: actor.id,
					},
				})
			}
			// Accessories: one INSTALL movement per line.
			for (const a of i.accessories) {
				if (a.qty > 0)
					await tx.vanMovement.create({
						data: {
							vanId: i.vanId,
							serviceCodeId: a.serviceCodeId,
							qty: -a.qty,
							type: "INSTALL",
							refCompletionId: completion.id,
							byUserId: actor.id,
						},
					})
			}

			const paymentRequest = await tx.paymentRequest.create({
				data: {
					kind: "INSTALL",
					completionId: completion.id,
					installerId: i.installerId,
					status,
					missing,
					attachments: [
						i.formPhotoPath && { kind: "formPhoto", path: i.formPhotoPath },
					].filter(Boolean) as never,
				},
			})

			return { completionId: completion.id, paymentRequest }
		})
		completionId = result.completionId
		paymentRequestId = result.paymentRequest.id
		paymentRequestStatus = result.paymentRequest.status
	} catch (e) {
		// Concurrent double-submit (reconnect fires + user retaps): the losing
		// request hits the idempotencyKey unique constraint. Return the winner's
		// row instead of surfacing a 500 (Review Focus: offline double-submit).
		if (
			e &&
			typeof e === "object" &&
			"code" in e &&
			(e as { code?: string }).code === "P2002"
		) {
			const won = await db.installCompletion.findUniqueOrThrow({
				where: { idempotencyKey: i.idempotencyKey },
			})
			const pr = await db.paymentRequest.findFirstOrThrow({
				where: { completionId: won.id },
			})
			return {
				completionId: won.id,
				paymentRequestId: pr.id,
				status: pr.status,
			}
		}
		throw e
	}

	// Completion PDF (best-effort, outside the tx) + notify installer supervisor.
	try {
		const codes = await db.serviceCode.findMany({
			where: { id: { in: i.accessories.map((a) => a.serviceCodeId) } },
		})
		const nameMap = Object.fromEntries(
			codes.map((c) => [c.id, { code: c.claroCode, name: c.name }]),
		)
		const inst = await db.user.findUniqueOrThrow({
			where: { id: i.installerId },
			include: { installerProfile: true },
		})
		const pdf = await generateInstallCompletionPdf({
			claroOrderNo: i.claroOrderNo,
			installerName: inst.name,
			jafNumber: inst.installerProfile?.jafNumber ?? "",
			toaNumber: inst.installerProfile?.toaNumber ?? "",
			address: i.address,
			serialInstalled: i.serialInstalled,
			modelResolved: i.modelResolved,
			dropFt: i.dropFt,
			accessories: i.accessories.map((a) => ({
				code: nameMap[a.serviceCodeId]?.code ?? "?",
				name: nameMap[a.serviceCodeId]?.name ?? "?",
				qty: a.qty,
			})),
			installedAt: i.installedAt,
			signature: i.sigInstaller,
		})
		const dir = path.join(
			process.env.UPLOAD_DIR || "/tmp/jaf/uploads",
			"completions",
		)
		await fs.mkdir(dir, { recursive: true })
		const pdfPath = path.join(dir, `${completionId}.pdf`)
		await fs.writeFile(pdfPath, pdf)
		await db.installCompletion.update({
			where: { id: completionId },
			data: { completionPdfPath: pdfPath },
		})
	} catch {
		/* PDF is best-effort; the completion + payment request are the source of truth */
	}

	const supervisors = await db.user.findMany({
		where: { role: "INSTALLER_SUPERVISOR", active: true },
		select: { id: true },
	})
	await db.$transaction(
		supervisors.map((s) =>
			db.notification.create({
				data: {
					userId: s.id,
					message: `Completion ${i.claroOrderNo} submitted by an installer.`,
				},
			}),
		),
	)

	return { completionId, paymentRequestId, status: paymentRequestStatus }
}
