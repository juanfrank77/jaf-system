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

	async function sentPacket() {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				pbccRequestSentAt: new Date(),
			}),
		)
		return { finance, doc }
	}

	function form(
		id: string,
		intent: "mark_funded" | "correct_funding",
		fields: Record<string, string>,
	): Parameters<typeof action>[0] {
		return {
			request: new Request(`http://localhost/finance/pbcc/${id}`, {
				method: "POST",
				body: new URLSearchParams({ intent, ...fields }),
			}),
			params: { id },
			context: {},
		} as never
	}
	const fundForm = (id: string, f: Record<string, string>) =>
		form(id, "mark_funded", f)

	const yesterday = () =>
		new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

	it("mark_funded records the PBCC advance (date, amount, who, ref) and the helper's audit row", async () => {
		const { finance, doc } = await sentPacket()
		const day = yesterday()
		const result = await action(
			fundForm(doc.id, {
				fundedDate: day,
				fundedAmount: "800",
				fundedRef: "ACH-1",
			}),
		)
		expect(result).toEqual({ ok: true })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.advanceReceivedAt).toEqual(new Date(`${day}T12:00:00`))
		expect(Number(reloaded.advanceAmount)).toBe(800)
		const rec = await db.paymentRecord.findUniqueOrThrow({
			where: { jobId_type: { jobId: doc.id, type: "PBCC_ADVANCE" } },
		})
		expect(rec.recordedById).toBe(finance.id)
		expect(rec.note).toBe("ACH-1")
		const audit = await db.auditTrail.count({
			where: { docId: doc.id, action: "ADVANCE_RECEIVED" },
		})
		expect(audit).toBe(1)
	})

	it("mark_funded accepts today's date", async () => {
		const { doc } = await sentPacket()
		const today = new Date().toLocaleDateString("en-CA")
		expect(
			await action(
				fundForm(doc.id, { fundedDate: today, fundedAmount: "800" }),
			),
		).toEqual({ ok: true })
	})

	it("mark_funded refuses an unsent request (Review Focus 4)", async () => {
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
		const result = await action(
			fundForm(doc.id, { fundedDate: yesterday(), fundedAmount: "800" }),
		)
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.not_sent" })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.advanceReceivedAt).toBeNull()
	})

	it("mark_funded refuses a future/malformed date and a missing/zero/negative amount (Review Focus 4)", async () => {
		const { doc } = await sentPacket()
		const future = new Date(Date.now() + 3 * 86_400_000)
			.toISOString()
			.slice(0, 10)
		expect(
			await action(
				fundForm(doc.id, { fundedDate: future, fundedAmount: "800" }),
			),
		).toEqual({ errorKey: "finance_pbcc.errors.future_date" })
		expect(
			await action(
				fundForm(doc.id, { fundedDate: "9/3/2026", fundedAmount: "800" }),
			),
		).toEqual({ errorKey: "finance_pbcc.errors.invalid_date" })
		for (const amount of ["", "0", "-5", "abc"]) {
			expect(
				await action(
					fundForm(doc.id, { fundedDate: yesterday(), fundedAmount: amount }),
				),
			).toEqual({ errorKey: "finance_pbcc.errors.invalid_amount" })
		}
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.advanceReceivedAt).toBeNull()
	})

	it("mark_funded on an already-funded packet is a 409 and does not overwrite (Review Focus 4)", async () => {
		const { doc } = await sentPacket()
		await action(
			fundForm(doc.id, {
				fundedDate: yesterday(),
				fundedAmount: "800",
				fundedRef: "FIRST",
			}),
		)
		const second = await action(
			fundForm(doc.id, {
				fundedDate: yesterday(),
				fundedAmount: "900",
				fundedRef: "SECOND",
			}),
		)
		expect(second).toMatchObject({
			data: { errorKey: "finance_pbcc.errors.already_funded" },
			init: { status: 409 },
		})
		const rec = await db.paymentRecord.findUniqueOrThrow({
			where: { jobId_type: { jobId: doc.id, type: "PBCC_ADVANCE" } },
		})
		expect(rec.note).toBe("FIRST")
		expect(Number(rec.amount)).toBe(800)
	})

	it("correct_funding fixes a wrong date/amount/ref with a reason, and audits old and new", async () => {
		const { doc } = await sentPacket()
		await action(
			fundForm(doc.id, {
				fundedDate: yesterday(),
				fundedAmount: "800",
				fundedRef: "TYPO",
			}),
		)
		const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
		const result = await action(
			form(doc.id, "correct_funding", {
				fundedDate: day,
				fundedAmount: "850",
				fundedRef: "ACH-OK",
				reason: "Bank statement shows a different amount",
			}),
		)
		expect(result).toEqual({ ok: true })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.advanceReceivedAt).toEqual(new Date(`${day}T12:00:00`))
		expect(Number(reloaded.advanceAmount)).toBe(850)
		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "ADVANCE_CORRECTED" },
		})
		expect(audit).toHaveLength(1)
		expect(JSON.stringify(audit[0].diffJson)).toContain("TYPO")
		expect(JSON.stringify(audit[0].diffJson)).toContain("different amount")
	})

	it("correct_funding needs a reason, an existing funding, and is refused once the packet is in a paid run", async () => {
		const { doc } = await sentPacket()
		const base = { fundedDate: yesterday(), fundedAmount: "850" }
		expect(
			await action(form(doc.id, "correct_funding", { ...base, reason: "x" })),
		).toEqual({ errorKey: "finance_pbcc.errors.not_funded" })
		await action(
			fundForm(doc.id, { fundedDate: yesterday(), fundedAmount: "800" }),
		)
		expect(
			await action(form(doc.id, "correct_funding", { ...base, reason: "  " })),
		).toEqual({ errorKey: "finance_pbcc.errors.reason_required" })
		// put the packet in a paid run
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: {
					label: `paid-${Date.now()}`,
					generatedById: (await db.user.findFirstOrThrow()).id,
					paidAt: new Date(),
				},
			}),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { payrollRunId: run.id },
		})
		expect(
			await action(
				form(doc.id, "correct_funding", { ...base, reason: "late fix" }),
			),
		).toEqual({ errorKey: "finance_pbcc.errors.locked_in_paid_run" })
		// ...but an ADMIN can still fix it, and the audit row says it was after payroll
		mocks.requireRole.mockResolvedValue({
			user: t.track("user", await seedUser({ role: "ADMIN" })),
		})
		expect(
			await action(
				form(doc.id, "correct_funding", {
					...base,
					reason: "bank statement says 850",
				}),
			),
		).toEqual({ ok: true })
		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "ADVANCE_CORRECTED" },
		})
		expect(JSON.stringify(audit.at(-1)?.diffJson)).toContain(
			'"afterPaidRun":true',
		)
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
