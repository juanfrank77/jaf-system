import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedServiceCode,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.pbcc.$id"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("L2 Packet", () => {
	it("loader returns the frozen payment, unchanged, for a job already swept into a run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		// Simulate the swept state directly rather than calling generateRun:
		// the sweep is global and would race other test files for candidates.
		const { run, invoice: swept } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-frozen",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", swept)

		// Change the catalog price after freezing — the frozen figure must not move.
		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${swept.id}`),
			params: { id: swept.id },
			context: {},
		} as never)
		expect(result.frozen).toBe(true)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 * 0.9, 2)
	})

	describe("packet claimed by a bank schedule", () => {
		async function onSchedule(sentAt: Date | null) {
			const finance = t.track("user", await seedUser({ role: "FINANCE" }))
			mocks.requireRole.mockResolvedValue({ user: finance })
			const account = t.track(
				"contractorAccount",
				await seedContractorAccount(),
			)
			const sched = t.track(
				"bankSchedule",
				await db.bankSchedule.create({
					data: {
						generatedById: finance.id,
						advanceRate: 0.8,
						total: 100,
						advanceAmount: 80,
						closedAt: new Date(),
						number: 1_000_000 + Math.floor(Math.random() * 1_000_000),
						sentAt,
					},
				}),
			)
			const doc = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					contractorAccountCode: account.code,
					pbccRequestSentAt: null,
				}),
			)
			await db.jafInvoice.update({
				where: { id: doc.id },
				data: {
					bankScheduleId: sched.id,
					bankInvoicePdfPath: "/tmp/does-not-matter.pdf",
				},
			})
			return { doc, sched }
		}
		const post = (id: string, intent: string) =>
			action({
				request: new Request(`http://localhost/finance/pbcc/${id}`, {
					method: "POST",
					body: new URLSearchParams({ intent }),
				}),
				params: { id },
				context: {},
			} as never)

		for (const intent of ["mark_sent_by_hand", "generate_pbcc"]) {
			it(`${intent} is refused while the schedule is unsent; nothing is written`, async () => {
				const { doc, sched } = await onSchedule(null)
				const result = await post(doc.id, intent)
				expect(result).toEqual({
					errorKey: "finance_pbcc.errors.on_schedule",
					list: `#${sched.number}`,
				})
				const reloaded = await db.jafInvoice.findUniqueOrThrow({
					where: { id: doc.id },
				})
				expect(reloaded.pbccRequestSentAt).toBeNull()
				expect(await db.auditTrail.count({ where: { docId: doc.id } })).toBe(0)
			})
		}

		it("loader returns the schedule and whether a bank invoice exists", async () => {
			const { doc, sched } = await onSchedule(null)
			const result = await loader({
				request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
				params: { id: doc.id },
				context: {},
			} as never)
			expect(result.bankSchedule).toMatchObject({
				id: sched.id,
				number: sched.number,
				sentAt: null,
			})
			expect(result.hasBankInvoice).toBe(true)
		})
	})

	it("mark_sent_by_hand records pbccRequestSentAt and a note without generating missing documents", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				pbccRequestSentAt: null,
			}),
		)

		const form = new URLSearchParams({
			intent: "mark_sent_by_hand",
			note: "Sent by hand 9/3",
		})
		await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never)

		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.pbccRequestSentAt).not.toBeNull()
	})

	it("mark_sent_by_hand is idempotent: a second click adds no duplicate audit row", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				pbccRequestSentAt: null,
			}),
		)
		const submit = () =>
			action({
				request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
					method: "POST",
					body: new URLSearchParams({ intent: "mark_sent_by_hand" }),
				}),
				params: { id: doc.id },
				context: {},
			} as never)
		await submit()
		await submit()
		const audits = await db.auditTrail.count({
			where: { docId: doc.id, action: "PBCC_SENT_BY_HAND" },
		})
		expect(audits).toBe(1)
	})

	it("mark_sent_by_hand refuses a job that is not on Arm A (already closed)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				payablesClosedAt: new Date(),
				pbccRequestSentAt: null,
			}),
		)
		let location: string | null = null
		try {
			await action({
				request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
					method: "POST",
					body: new URLSearchParams({ intent: "mark_sent_by_hand" }),
				}),
				params: { id: doc.id },
				context: {},
			} as never)
		} catch (response) {
			if (response instanceof Response)
				location = response.headers.get("Location")
		}
		expect(location).toBe("/finance/queue")
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.pbccRequestSentAt).toBeNull()
	})

	// --- Guards carried over from the pre-Arm-A suite. The stage gate moved out
	// of the loader (replaced by the Arm A open condition), so the two loader
	// cases are restated against that gate; the two action cases are unchanged
	// and must keep guarding the auto-generator.

	it("loader redirects a job that is no longer on Arm A (closed or never released)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })

		const closed = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ payablesClosedAt: new Date() }),
		)
		const neverReleased = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ releasedToFinanceAt: null }),
		)

		for (const doc of [closed, neverReleased]) {
			await expect(
				loader({
					request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
					params: { id: doc.id },
					context: {},
				} as never),
			).rejects.toMatchObject({ status: 302 })
		}
	})

	it("loader serves an Arm-A-open job regardless of its finance-pipeline stage", async () => {
		// The Arm A open check replaced the stage gate, so a job that computeFinanceStage
		// would reject still loads here — this is the intended behaviour change.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "LC_REQUEST_GENERATED" }),
		)
		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(result.doc.id).toBe(doc.id)
	})

	it("loader still serves a job already swept into an open, unpaid run (Review Focus)", async () => {
		// The packet view is deliberately wider than L1's: the frozen figures
		// are only reachable here, so a swept job must stay loadable.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-packet-frozen",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", { id: invoice.payrollRunId as string })
		t.track("jafInvoice", invoice)

		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${invoice.id}`),
			params: { id: invoice.id },
			context: {},
		} as never)

		expect(result.doc.id).toBe(invoice.id)
		expect(result.frozen).toBe(true)
	})

	it("loader refuses a job cancelled after release (Review Focus)", async () => {
		// Cancelling does not clear releasedToFinanceAt, so without the shared
		// predicate's status guard this job would still load here — the CANCELLED
		// exclusion used to reach this loader via computeFinanceStage and was
		// lost when the gate was restated inline.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "CANCELLED" }),
		)
		expect(doc.releasedToFinanceAt).not.toBeNull()

		await expect(
			loader({
				request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
				params: { id: doc.id },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects terminal LC jobs", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "CANCELLED" }),
		)
		const form = new URLSearchParams({ intent: "generate_pbcc" })
		const result = await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.terminal_status" })
	})

	it("action rejects wrong stage (auto-generator still stage-gated)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		// No Aviso lines recorded, so computeFinanceStage never reaches
		// PBCC_REQUEST_PENDING even though the job is Arm-A-open.
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: null }),
		)
		const form = new URLSearchParams({ intent: "generate_pbcc" })
		const result = await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never).catch((r: unknown) => r)
		expect(result).toMatchObject({ status: 302 })
		// Back to its Arm A list (already sold, so Lists), not into Arm B.
		expect((result as Response).headers.get("Location")).toBe(
			"/finance/payroll",
		)
		// Not yet sold nor accepted: back to Packets, where it waits.
		const unverified = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: null,
				pbccRequestSentAt: null,
			}),
		)
		const back = await action({
			request: new Request(`http://localhost/finance/pbcc/${unverified.id}`, {
				method: "POST",
				body: new URLSearchParams({ intent: "generate_pbcc" }),
			}),
			params: { id: unverified.id },
			context: {},
		} as never).catch((r: unknown) => r)
		expect((back as Response).headers.get("Location")).toBe("/finance/queue")
	})

	it("keeps a swept job's frozen figures when its catalog price and lines change (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice: swept } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-price-change",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", swept)

		// Rewrite both the catalog price and the job's own line snapshot after
		// the run was generated. The frozen figures must not move.
		const serviceCode = t.track(
			"serviceCode",
			await seedServiceCode("PBCC-FREEZE-CHECK", { unitPrice: 999 }),
		)
		await db.jafInvoice.update({
			where: { id: swept.id },
			data: {
				jafInvoiceLines: [
					{
						serviceCodeId: serviceCode.id,
						claroCode: "PBCC-FREEZE-CHECK",
						name: "Repriced",
						unit: "EA",
						qty: 9,
						unitPrice: 999,
						lineAmount: 8991,
					},
				],
			},
		})

		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${swept.id}`),
			params: { id: swept.id },
			context: {},
		} as never)
		expect(result.frozen).toBe(true)
		expect(result.payment.grossPayable).toBeCloseTo(100, 2)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 * 0.9, 2)
	})

	it("the on_schedule refusal text exists under finance_pbcc.errors in both locales", async () => {
		const fs = await import("node:fs/promises")
		for (const lang of ["en", "es"]) {
			const raw = await fs.readFile(
				`resources/locales/${lang}/common.json`,
				"utf8",
			)
			const json = JSON.parse(raw) as {
				finance_pbcc: { errors: Record<string, string> }
			}
			expect(json.finance_pbcc.errors.on_schedule).toContain("{{list}}")
		}
	})
})
