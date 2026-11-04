import { Prisma } from "../../generated/prisma/client"
import { db } from "./db.server"
import { parseEwitInstallerNo } from "./ewit-installer-no"

export type SetEwitInstallerNoResult =
	| { ok: true }
	| {
			ok: false
			errorKey:
				| "admin_users.errors.ewit_no_invalid"
				| "admin_users.errors.ewit_no_taken"
				| "admin_users.errors.update_invalid"
	  }

/** Admin sets (or, when blank, clears) an installer's EWIT installer #. */
export async function setEwitInstallerNo(
	userId: string,
	raw: string,
): Promise<SetEwitInstallerNoResult> {
	const blank = raw.trim() === ""
	const value = blank ? null : parseEwitInstallerNo(raw)
	if (!blank && value === null)
		return { ok: false, errorKey: "admin_users.errors.ewit_no_invalid" }
	try {
		await db.installerProfile.update({
			where: { userId },
			data: { ewitInstallerNo: value },
		})
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError) {
			if (e.code === "P2002")
				return { ok: false, errorKey: "admin_users.errors.ewit_no_taken" }
			if (e.code === "P2025")
				return { ok: false, errorKey: "admin_users.errors.update_invalid" }
		}
		throw e
	}
	return { ok: true }
}
