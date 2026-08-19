import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./db.server", () => ({ db: { auditTrail: { create: vi.fn() } } }))

import { db } from "./db.server"
import { sendInternalEmail, setInternalEmailTransport } from "./email.server"

describe("internal email helper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setInternalEmailTransport(null)
	})
	it("logs an unconfigured attempt without claiming delivery", async () => {
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: ["finance@example.com"],
			subject: "Subject",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "INTERNAL_EMAIL_ATTEMPT",
					diffJson: expect.objectContaining({
						outcome: "UNCONFIGURED",
						recipients: ["finance@example.com"],
						subject: "Subject",
						context: "TEST",
					}),
				}),
			}),
		)
	})
	it("logs sent and failed transport outcomes", async () => {
		setInternalEmailTransport(vi.fn().mockResolvedValue(undefined))
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Sent",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({ outcome: "SENT" }),
				}),
			}),
		)
		setInternalEmailTransport(
			vi.fn().mockRejectedValue(new Error("token=secret-value")),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: "[redacted]",
					}),
				}),
			}),
		)
	})
	it("redacts password and secret patterns", async () => {
		setInternalEmailTransport(
			vi.fn().mockRejectedValue(new Error("password: secret123")),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: "[redacted]",
					}),
				}),
			}),
		)
	})
	it("redacts secret=value patterns", async () => {
		setInternalEmailTransport(
			vi.fn().mockRejectedValue(new Error("api_key=abc123")),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: "[redacted]",
					}),
				}),
			}),
		)
	})
	it("redacts authorization Bearer tokens", async () => {
		setInternalEmailTransport(
			vi.fn().mockRejectedValue(new Error("authorization: Bearer abc123.def")),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: "[redacted]",
					}),
				}),
			}),
		)
	})
	it("redacts JSON password and secret fields", async () => {
		setInternalEmailTransport(
			vi.fn().mockRejectedValue(new Error('{"password":"xyz","secret":"123"}')),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: expect.stringContaining("[redacted]"),
					}),
				}),
			}),
		)
	})
	it("redacts private key blocks", async () => {
		setInternalEmailTransport(
			vi
				.fn()
				.mockRejectedValue(
					new Error(
						"-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRErTkMG1IQ\n-----END RSA PRIVATE KEY-----",
					),
				),
		)
		await sendInternalEmail({
			docId: "job-1",
			actorId: "user-1",
			recipients: [],
			subject: "Failed",
			context: "TEST",
		})
		expect(db.auditTrail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						outcome: "FAILED",
						error: "[redacted]",
					}),
				}),
			}),
		)
	})
})
