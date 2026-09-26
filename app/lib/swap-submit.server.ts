import type { SwapReason } from "../../generated/prisma/client"
import { db } from "./db.server"
import { nextSerialState } from "./van-inventory-v3"

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
	const outLoc = await db.serialLocation.findUnique({
		where: { serial: input.serialOut },
	})
	const inLoc = await db.serialLocation.findUnique({
		where: { serial: input.serialIn },
	})
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

	const swap = await db.swapEvent.create({
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

	const ops = [
		db.serialLocation.update({
			where: { serial: input.serialOut },
			data: {
				status: nextSerialState(outLoc?.status ?? null, "SWAP_OUT"),
				currentRef: input.vanId,
				since: new Date(),
			},
		}),
		db.vanMovement.create({
			data: {
				vanId: input.vanId,
				serviceCodeId: outLoc?.serviceCodeId ?? "",
				qty: 1,
				serial: input.serialOut,
				type: "SWAP_OUT",
				refSwapId: swap.id,
				byUserId: actor.id,
			},
		}),
		db.serialLocation.update({
			where: { serial: input.serialIn },
			data: {
				status: nextSerialState(inLoc?.status ?? null, "SWAP_IN"),
				currentRef: input.completionId,
				since: new Date(),
			},
		}),
		db.vanMovement.create({
			data: {
				vanId: input.vanId,
				serviceCodeId: inLoc?.serviceCodeId ?? "",
				qty: -1,
				serial: input.serialIn,
				type: "SWAP_IN",
				refSwapId: swap.id,
				byUserId: actor.id,
			},
		}),
		db.paymentRequest.create({
			data: {
				kind: "CALLBACK",
				swapId: swap.id,
				installerId: input.installerId,
				status: "READY",
				missing: [],
				daysSinceInstall,
			},
		}),
	]
	await db.$transaction(ops)
	const pr = await db.paymentRequest.findFirstOrThrow({
		where: { swapId: swap.id },
	})
	return { swapId: swap.id, paymentRequestId: pr.id }
}
