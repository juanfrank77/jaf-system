import { PrismaClient } from "../../generated/prisma/client"

// TODO: Prisma 7 requires a driver adapter (e.g. @prisma/adapter-pg or @prisma/adapter-neon).
// Owner needs to confirm which adapter to use and install the corresponding package.
// See: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/driver-adapters

declare global {
	// eslint-disable-next-line no-var
	var __db__: PrismaClient | undefined
}

let db: PrismaClient

if (process.env.NODE_ENV === "production") {
	// @ts-expect-error adapter not yet configured — see above TODO
	db = new PrismaClient()
} else {
	if (!global.__db__) {
		// @ts-expect-error adapter not yet configured — see above TODO
		global.__db__ = new PrismaClient()
	}
	db = global.__db__
}

export { db }
