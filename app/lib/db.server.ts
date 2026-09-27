import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../generated/prisma/client"

declare global {
	// eslint-disable-next-line no-var
	var __db__: PrismaClient | undefined
}

function createClient(poolMax?: number) {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) {
		throw new Error("DATABASE_URL is not set")
	}
	return new PrismaClient({
		adapter: new PrismaPg({ connectionString, max: poolMax }),
	})
}

let db: PrismaClient

if (process.env.NODE_ENV === "production") {
	db = createClient()
} else if (process.env.VITEST) {
	// Vitest runs each server test file in its own worker, each importing
	// this module fresh and getting its own pool — with dozens of files
	// running in parallel against one shared dev database, an uncapped pool
	// (pg's default max is 10 per pool) exhausts the database's connection
	// limit and causes unrelated files' beforeAll hooks to fail/skip.
	db = createClient(3)
} else {
	if (!global.__db__) {
		global.__db__ = createClient()
	}
	db = global.__db__
}

export { db }
