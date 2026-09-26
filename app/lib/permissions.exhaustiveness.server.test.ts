import { expect, it } from "vitest"
import { Role } from "../../generated/prisma/client"
import { rolesMatching } from "./permissions"

// permissions.ts intentionally keeps a local literal role list rather than a
// runtime import of the Prisma Role enum (see its own comment) — this file
// alone is the exhaustiveness check, and only runs server-side, so it can
// safely import the real enum to catch drift if a Role member is ever added
// without updating that list.
it("rolesMatching's role list stays exhaustive against the Prisma Role enum", () => {
	const allByPredicate = rolesMatching(() => true).sort()
	const allFromPrisma = (Object.values(Role) as string[]).sort()
	expect(allByPredicate).toEqual(allFromPrisma)
})
