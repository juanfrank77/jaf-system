import fs from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedCompletion,
	seedInstaller,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader as warrantyLoader } from "./_app.comptroller.installers._index"
import { action as batchesAction } from "./_app.comptroller.installers.batches"
import {
	action as batchAction,
	loader as batchLoader,
} from "./_app.comptroller.installers.batches.$id"
import { action as ewitListAction } from "./_app.comptroller.installers.ewit"
import {
	action as newAction,
	loader as newLoader,
} from "./_app.comptroller.installers.ewit.new"
import { action as payAction } from "./_app.comptroller.installers.pay"

const t = makeTracker()
let uploadDir: string
const prevUploadDir = process.env.UPLOAD_DIR
let carmen: Awaited<ReturnType<typeof seedUser>>
let installer: Awaited<ReturnType<typeof seedInstaller>>

beforeAll(async () => {
	uploadDir = await fs.mkdtemp("/tmp/installers-route-")
	process.env.UPLOAD_DIR = uploadDir
	carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
	mocks.requireRole.mockResolvedValue({ user: carmen })
	installer = await seedInstaller({
		name: "Route Installer",
		jafNumber: "1999",
	})
	t.track("user", installer.user)
	t.track("van", installer.van)
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prevUploadDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

const doc = async () =>
	t.track(
		"installCompletion",
		await seedCompletion({
			installerId: installer.user.id,
			vanId: installer.van.id,
			orderNo: `RT${runToken("o").replace(/\D/g, "").slice(-9)}`,
		}),
	)

const post = (fields: Record<string, string | string[] | File>) => {
	const form = new FormData()
	for (const [k, v] of Object.entries(fields))
		for (const x of Array.isArray(v) ? v : [v]) form.append(k, x)
	return new Request("http://localhost/x", { method: "POST", body: form })
}
const pdf = () =>
	new File([new Uint8Array([37, 80, 68, 70])], "i.pdf", {
		type: "application/pdf",
	})
const params = (id: string) => ({ params: { id }, context: {} })
const redirectOf = (res: unknown) => {
	const r = res as Response
	expect(r.status).toBe(302)
	return new URL(r.headers.get("Location") as string, "http://localhost")
}
const errorOf = (res: unknown) =>
	(res as { data: { errorKey: string } }).data?.errorKey ??
	(res as { errorKey: string }).errorKey

describe("Carmen's installer screens", () => {
	it("warranty docs: search by order # and filter by installer", async () => {
		const d = await doc()
		const base = "http://localhost/comptroller/installers"
		const run = (q: string) =>
			warrantyLoader({
				request: new Request(`${base}?${q}`),
				params: {},
				context: {},
			} as never)
		const hit = await run(`q=${d.claroOrderNo.slice(0, 8)}`)
		expect(hit.docs.map((x) => x.id)).toContain(d.id)
		expect(hit.docs[0].photoHref).toContain("/files/completions/")
		expect((await run("q=zzzz-no-such")).docs).toHaveLength(0)
		expect(
			(await run(`installer=${installer.user.id}`)).docs.map((x) => x.id),
		).toContain(d.id)
	})

	it("adds an EWIT invoice, shows a receipt, and says why a bad one is refused", async () => {
		const d = await doc()
		const number = runToken("RTEW")
		const ok = redirectOf(
			await newAction({
				request: post({
					number,
					invoiceDate: "10/20/2026",
					total: "$4,760.25",
					file: pdf(),
					completionId: [d.id],
					typed: "",
				}),
				params: {},
				context: {},
			} as never),
		)
		expect(ok.pathname).toBe("/comptroller/installers/ewit")
		expect(ok.searchParams.get("receipt")).toBe("ewit_saved")
		expect(ok.searchParams.get("a")).toBe(number)
		const inv = await db.ewitInvoice.findUniqueOrThrow({ where: { number } })
		t.track("ewitInvoice", inv)
		if (inv.batchId) t.track("ewitBatch", { id: inv.batchId })

		const bad = (fields: Record<string, string | string[] | File>) =>
			newAction({ request: post(fields), params: {}, context: {} } as never)
		const e = await doc()
		expect(
			errorOf(
				await bad({
					number: runToken("X"),
					invoiceDate: "10/20/2026",
					total: "5000.01",
					file: pdf(),
					completionId: [e.id],
				}),
			),
		).toBe("installers.errors.over_limit")
		expect(
			errorOf(
				await bad({
					number: runToken("X"),
					invoiceDate: "not a date",
					total: "10",
					file: pdf(),
					completionId: [e.id],
				}),
			),
		).toBe("installers.errors.invalid_date")
		// The order that is already on an invoice is named back.
		const again = (await bad({
			number: runToken("X"),
			invoiceDate: "10/20/2026",
			total: "10",
			file: pdf(),
			completionId: [d.id],
		})) as { data: { orders: string } }
		expect(again.data.orders).toContain(d.claroOrderNo)
		const loaded = await newLoader({
			request: new Request("http://localhost/x"),
			params: {},
			context: {},
		} as never)
		expect(loaded.docs.map((x) => x.id)).toContain(e.id)
	})

	it("takes an invoice back from the open batch and says so", async () => {
		const d = await doc()
		const number = runToken("RTBK")
		await newAction({
			request: post({
				number,
				invoiceDate: "10/20/2026",
				total: "10",
				file: pdf(),
				completionId: [d.id],
			}),
			params: {},
			context: {},
		} as never)
		const inv = await db.ewitInvoice.findUniqueOrThrow({ where: { number } })
		t.track("ewitInvoice", inv)
		if (inv.batchId) t.track("ewitBatch", { id: inv.batchId })
		const back = redirectOf(
			await ewitListAction({
				request: post({
					intent: "take_back",
					invoiceId: inv.id,
					reason: "typo",
				}),
				params: {},
				context: {},
			} as never),
		)
		expect(back.searchParams.get("receipt")).toBe("ewit_removed")
		expect(back.searchParams.get("a")).toBe(number)
	})

	it("closes the batch, marks it sent, takes the statement, pays the installer and undoes it", async () => {
		const d = await doc()
		const number = runToken("RTFL")
		await newAction({
			request: post({
				number,
				invoiceDate: "10/20/2026",
				total: "1500",
				file: pdf(),
				completionId: [d.id],
			}),
			params: {},
			context: {},
		} as never)
		const inv = await db.ewitInvoice.findUniqueOrThrow({ where: { number } })
		t.track("ewitInvoice", inv)
		const batchId = inv.batchId as string
		t.track("ewitBatch", { id: batchId })

		const closed = redirectOf(
			await batchesAction({
				request: post({ intent: "close_batch", batchId }),
				params: {},
				context: {},
			} as never),
		)
		expect(closed.pathname).toBe(`/comptroller/installers/batches/${batchId}`)
		expect(closed.searchParams.get("receipt")).toBe("ewit_batch_closed")
		const fresh = await db.ewitBatch.findFirstOrThrow({
			where: { closedAt: null, createdById: carmen.id },
		})
		t.track("ewitBatch", fresh)

		const view = await batchLoader({
			request: new Request("http://localhost/x"),
			...params(batchId),
		} as never)
		expect(view.check?.passed).toBe(true)
		expect(view.invoices.find((i) => i.number === number)).toMatchObject({
			total: 1500,
		})

		const sent = redirectOf(
			await batchAction({
				request: post({ intent: "mark_sent" }),
				...params(batchId),
			} as never),
		)
		expect(sent.searchParams.get("receipt")).toBe("ewit_batch_sent")

		// No file: refused, nothing stamped.
		expect(
			errorOf(
				await batchAction({
					request: post({
						intent: "receive_statement",
						receivedAt: "10/21/2026",
						amount: "1500",
						invoiceId: [inv.id],
					}),
					...params(batchId),
				} as never),
			),
		).toBe("installers.errors.no_file")
		const saved = redirectOf(
			await batchAction({
				request: post({
					intent: "receive_statement",
					receivedAt: "10/21/2026",
					amount: "1500",
					file: pdf(),
					invoiceId: [inv.id],
				}),
				...params(batchId),
			} as never),
		)
		expect(saved.searchParams.get("receipt")).toBe("statement_saved")
		expect(saved.searchParams.get("n")).toBe("1")

		// Pay: nobody ticked, then no amount, then the real thing.
		const pay = (fields: Record<string, string | string[]>) =>
			payAction({ request: post(fields), params: {}, context: {} } as never)
		expect(
			errorOf(await pay({ intent: "pay_installers", paidDate: "10/21/2026" })),
		).toBe("installers.errors.pick_installer")
		expect(
			errorOf(
				await pay({
					intent: "pay_installers",
					paidDate: "10/21/2026",
					installerId: [installer.user.id],
				}),
			),
		).toBe("installers.errors.bad_amount")
		const paid = redirectOf(
			await pay({
				intent: "pay_installers",
				paidDate: "10/21/2026",
				installerId: [installer.user.id],
				[`amount_${installer.user.id}`]: "120.00",
			}),
		)
		expect(paid.searchParams.get("receipt")).toBe("installers_paid")
		const payment = await db.installerPayment.findFirstOrThrow({
			where: { installerId: installer.user.id },
		})
		t.track("installerPayment", payment)
		expect(
			errorOf(
				await pay({
					intent: "undo_payment",
					paymentId: payment.id,
					reason: "",
				}),
			),
		).toBe("installers.errors.no_reason")
		const undone = redirectOf(
			await pay({
				intent: "undo_payment",
				paymentId: payment.id,
				reason: "wrong amount",
			}),
		)
		expect(undone.searchParams.get("receipt")).toBe("payment_undone")
	}, 90_000)
})
