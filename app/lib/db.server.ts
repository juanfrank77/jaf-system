import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../generated/prisma/client"

declare global {
	// eslint-disable-next-line no-var
	var __db__: PrismaClient | undefined
}

function createClient() {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) {
		throw new Error("DATABASE_URL is not set")
	}
	return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

let db: PrismaClient

if (process.env.NODE_ENV === "production") {
	db = createClient()
} else {
	if (!global.__db__) {
		global.__db__ = createClient()
	}
	db = global.__db__
}

export { db }
