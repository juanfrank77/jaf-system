import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))

import { requireSession } from "~/lib/permissions.server"
import routes from "../routes"
import { loader as awaitingAriba } from "./_app.finance.awaiting-ariba"
import { loader as awaitingPo } from "./_app.finance.awaiting-po"
import { loader as awaitingPoId } from "./_app.finance.awaiting-po.$id"
import { loader as paymentAdvice } from "./_app.finance.payment-advice"
import { loader as receivables } from "./_app.finance.receivables"

type RouteEntry = { path?: string; file: string; children?: RouteEntry[] }

function flatRoutes(): Map<string, string> {
	const out = new Map<string, string>()
	const walk = (rs: readonly RouteEntry[]) => {
		for (const r of rs) {
			if (r.path) out.set(r.path, r.file)
			if (r.children) walk(r.children)
		}
	}
	walk(routes as unknown as RouteEntry[])
	return out
}

async function locationOf(
	loader: (args: never) => Promise<unknown>,
	url: string,
	params: Record<string, string> = {},
): Promise<{ status: number; location: string | null }> {
	const res = await loader({
		request: new Request(`http://localhost${url}`),
		params,
	} as never).catch((r: unknown) => r)
	expect(res).toBeInstanceOf(Response)
	const r = res as Response
	return { status: r.status, location: r.headers.get("Location") }
}

beforeEach(() => {
	vi.mocked(requireSession).mockReset()
	vi.mocked(requireSession).mockResolvedValue({
		user: { id: "u1" },
	} as never)
})

describe("old Arm B URLs redirect to the five-step path", () => {
	it.each([
		["/finance/receivables", receivables, {}, "/finance/claro"],
		["/finance/awaiting-po", awaitingPo, {}, "/finance/claro"],
		[
			"/finance/awaiting-po/po123",
			awaitingPoId,
			{ id: "po123" },
			"/finance/claro/po123?step=review",
		],
		["/finance/awaiting-ariba", awaitingAriba, {}, "/finance/claro"],
		["/finance/payment-advice", paymentAdvice, {}, "/finance/claro/close"],
	] as const)("%s redirects to %s", async (url, loader, params, target) => {
		expect(await locationOf(loader as never, url, params)).toEqual({
			status: 302,
			location: target,
		})
	})

	it("sends a signed-out visitor to sign in instead", async () => {
		vi.mocked(requireSession).mockRejectedValue(
			new Response(null, { status: 302, headers: { Location: "/login" } }),
		)
		expect(
			await locationOf(receivables as never, "/finance/receivables"),
		).toEqual({ status: 302, location: "/login" })
	})

	it("keeps the old paths registered", () => {
		const flat = flatRoutes()
		for (const p of [
			"finance/receivables",
			"finance/awaiting-po",
			"finance/awaiting-po/:id",
			"finance/awaiting-ariba",
			"finance/payment-advice",
		])
			expect(flat.has(p), p).toBe(true)
	})

	it("the targets still resolve to route files that exist", () => {
		const flat = flatRoutes()
		for (const p of [
			"finance/claro",
			"finance/claro/close",
			"finance/claro/:id",
			"finance/claro/:id/file",
			"finance/claro/:id/invoice",
			"finance/payment-advice/:id/file",
		]) {
			const file = flat.get(p)
			expect(file, p).toBeDefined()
			expect(
				fs.existsSync(path.resolve(import.meta.dirname, "..", file as string)),
				p,
			).toBe(true)
		}
		expect(flat.get("finance/claro/close")).toBeDefined()
		const order = [...flat.keys()]
		expect(order.indexOf("finance/claro/close")).toBeLessThan(
			order.indexOf("finance/claro/:id"),
		)
	})

	it("drops the routes the redirects replace", () => {
		const flat = flatRoutes()
		for (const p of [
			"finance/awaiting-po/:id/file",
			"finance/awaiting-ariba/:id/file",
			"finance/awaiting-ariba/zip",
		])
			expect(flat.has(p), p).toBe(false)
	})
})
