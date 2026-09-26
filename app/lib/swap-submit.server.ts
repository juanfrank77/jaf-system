import type { SwapReason } from "../../generated/prisma/client"
import { db } from "./db.server"

export async function submitSwap(
	input: {
		completionId: string
		serialOut: string
		serialOutPhotoPath?: string
		reason: SwapReason
		serialIn: string
		serialInPhotoPath?: string
		newClaroOrderNo?: string
		installerId: string
		vanId: string
	},
	actor: { id: string },
): Promise<{ swapId: string; paymentRequestId: string }> {
	const completion = await db.installCompletion.findUniqueOrThrow({
		where: { id: input.completionId },
	})
	if (completion.installerId !== input.installerId) {
		throw new Error("Cannot swap against another installer's completion")
	}
	if (completion.status !== "SUBMITTED") {
		throw new Error(
			"Cannot swap against a completion that has not been submitted",
		)
	}
	const outLoc = await db.serialLocation.findUnique({
		where: { serial: input.serialOut },
	})
	const inLoc = await db.serialLocation.findUnique({
		where: { serial: input.serialIn },
	})
	// Spec §12: a mismatched record or an incoming serial not on the van are
	// non-blocking warnings — the swap still completes. Both are field-verified
	// corrective actions, so the transition here is intentionally permissive
	// (unlike nextSerialState's strict guard, which exists to catch programming
	// errors elsewhere, not to second-guess what a technician just scanned).
	const serialOutMatchedRecord = outLoc?.currentRef === input.completionId
	const serialInNotOnVan = !(
		inLoc &&
		inLoc.status === "VAN" &&
		inLoc.currentRef === input.vanId
	)
	const daysSinceInstall = Math.floor(
		(Date.now() - (completion.installedAt ?? completion.createdAt).getTime()) /
			86_400_000,
	)
	const outServiceCodeId = outLoc?.serviceCodeId ?? inLoc?.serviceCodeId ?? ""
	const inServiceCodeId = inLoc?.serviceCodeId ?? outLoc?.serviceCodeId ?? ""

	const { swap, paymentRequestId } = await db.$transaction(async (tx) => {
		const swap = await tx.swapEvent.create({
			data: {
				completionId: input.completionId,
				serialOut: input.serialOut,
				serialOutPhotoPath: input.serialOutPhotoPath,
				serialOutMatchedRecord,
				reason: input.reason,
				serialIn: input.serialIn,
				serialInPhotoPath: input.serialInPhotoPath,
				serialInNotOnVan,
				newClaroOrderNo: input.newClaroOrderNo ?? null,
				daysSinceInstall,
				byInstallerId: input.installerId,
			},
		})

		// `since` drives the owed-back episode key downstream (installer
		// supervisor notifications) — it must only move on a real transition
		// into REMOVED_PENDING_RETURN, not on every swap against an already
		// owed-back serial (which this upsert permissively allows; see the
		// comment above on serialOutMatchedRecord).
		await tx.serialLocation.upsert({
			where: { serial: input.serialOut },
			update:
				outLoc?.status === "REMOVED_PENDING_RETURN"
					? { currentRef: input.vanId }
					: {
							status: "REMOVED_PENDING_RETURN",
							currentRef: input.vanId,
							since: new Date(),
						},
			create: {
				serial: input.serialOut,
				serviceCodeId: outServiceCodeId,
				status: "REMOVED_PENDING_RETURN",
				currentRef: input.vanId,
			},
		})
		await tx.vanMovement.create({
			data: {
				vanId: input.vanId,
				serviceCodeId: outServiceCodeId,
				qty: 1,
				serial: input.serialOut,
				type: "SWAP_OUT",
				refSwapId: swap.id,
				byUserId: actor.id,
			},
		})

		await tx.serialLocation.upsert({
			where: { serial: input.serialIn },
			update: {
				status: "INSTALLED",
				currentRef: input.completionId,
				since: new Date(),
			},
			create: {
				serial: input.serialIn,
				serviceCodeId: inServiceCodeId,
				status: "INSTALLED",
				currentRef: input.completionId,
			},
		})
		await tx.vanMovement.create({
			data: {
				vanId: input.vanId,
				serviceCodeId: inServiceCodeId,
				qty: -1,
				serial: input.serialIn,
				type: "SWAP_IN",
				refSwapId: swap.id,
				byUserId: actor.id,
			},
		})

		const paymentRequest = await tx.paymentRequest.create({
			data: {
				kind: "CALLBACK",
				swapId: swap.id,
				installerId: input.installerId,
				status: "READY",
				missing: [],
				daysSinceInstall,
			},
		})
		return { swap, paymentRequestId: paymentRequest.id }
	})

	return { swapId: swap.id, paymentRequestId }
}
