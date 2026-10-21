import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	SUPERVISOR_QUEUES,
	type SupervisorQueue,
	supervisorQueueWhere,
} from "~/lib/supervisor-queues"
import {
	deriveSupervisorStage,
	type SupervisorStage,
} from "~/lib/supervisor-stage"

// Integration test against the test Postgres DB: one job per step of the rail,
// and every sidebar queue must list exactly the jobs whose step it is named
// for. This is the check that a list never disagrees with a job's own status.

const tag = `sq${Date.now()}`
const HOOK_TIMEOUT = 60_000
const approved = new Date("2026-10-10")

// RELEASE is not built: without sheet signatures a saved Aviso derives to
// Pre-cert, and Release shares that queue.
const JOBS: Partial<
	Record<SupervisorStage, { status: string; data: Record<string, unknown> }>
> = {
	INTAKE: { status: "CREATED", data: {} },
	WAREHOUSE: { status: "PREPPED", data: {} },
	FIELD: { status: "SIGNED", data: {} },
	APPROVE: { status: "FIELD_UPDATED", data: {} },
	INVOICE: {
		status: "SUPERVISOR_APPROVED",
		data: { supervisorApprovedAt: approved },
	},
	AVISO: {
		status: "SUPERVISOR_APPROVED",
		data: { supervisorApprovedAt: approved, jafInvoiceGeneratedAt: approved },
	},
	PRECERT: {
		status: "SUPERVISOR_APPROVED",
		data: {
			supervisorApprovedAt: approved,
			jafInvoiceGeneratedAt: approved,
			avisoNumber: "10354739",
			avisoDocPath: "/uploads/aviso.pdf",
		},
	},
	RELEASED: {
		status: "SUPERVISOR_APPROVED",
		data: {
			supervisorApprovedAt: approved,
			jafInvoiceGeneratedAt: approved,
			avisoNumber: "10354740",
			avisoDocPath: "/uploads/aviso2.pdf",
			releasedToFinanceAt: approved,
		},
	},
}
const STAGES = Object.keys(JOBS) as SupervisorStage[]

/** The queues each step's job belongs in. `all` is everything not an LC request. */
const EXPECTED: Record<string, SupervisorQueue[]> = {
	INTAKE: ["open", "intake", "all"],
	WAREHOUSE: ["open", "field", "all"],
	FIELD: ["open", "field", "all"],
	APPROVE: ["open", "review", "all"],
	INVOICE: ["invoice", "all"],
	// Sent to Claro still shows under Packets to Claro, flagged "Sent".
	AVISO: ["invoice", "aviso", "all"],
	PRECERT: ["precert", "all"],
	RELEASED: ["released", "all"],
}

describe("supervisor sidebar queues (integration)", () => {
	const ids: Record<string, string> = {}
	let supId = ""

	beforeAll(async () => {
		supId = (
			await db.user.create({
				data: {
					email: `sq-${tag}@x.com`,
					name: "QSup",
					role: "SUPERVISOR",
					supervisorAreas: [],
				},
			})
		).id
		for (const stage of STAGES) {
			const { status, data } = JOBS[stage] as NonNullable<
				(typeof JOBS)[SupervisorStage]
			>
			ids[stage] = (
				await db.jafInvoice.create({
					data: {
						controlNumber: `SQ-${stage}-${tag}`,
						jobType: "Install",
						jobAddressEstimated: "123 Main",
						estimatedMaterials: [],
						supervisorId: supId,
						status: status as never,
						...data,
					},
				})
			).id
		}
	}, HOOK_TIMEOUT)

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: tag } },
		})
		await db.user.delete({ where: { id: supId } })
	}, HOOK_TIMEOUT)

	it(
		"each job derives the step it was built for",
		async () => {
			for (const stage of STAGES) {
				const doc = await db.jafInvoice.findUniqueOrThrow({
					where: { id: ids[stage] },
				})
				expect(deriveSupervisorStage(doc, null), stage).toBe(stage)
			}
		},
		HOOK_TIMEOUT,
	)

	it(
		"every queue lists exactly the jobs on the steps it is named for",
		async () => {
			for (const queue of SUPERVISOR_QUEUES) {
				const listed = await db.jafInvoice.findMany({
					where: {
						AND: [
							{ controlNumber: { endsWith: tag } },
							supervisorQueueWhere(queue),
						],
					},
					select: { id: true },
				})
				const want = STAGES.filter((s) => EXPECTED[s].includes(queue)).map(
					(s) => ids[s],
				)
				expect(listed.map((d) => d.id).sort(), queue).toEqual(want.sort())
			}
		},
		HOOK_TIMEOUT,
	)

	it(
		"a cancelled job is in no queue but All",
		async () => {
			const cancelled = await db.jafInvoice.create({
				data: {
					controlNumber: `SQ-CANCELLED-${tag}`,
					jobType: "Install",
					jobAddressEstimated: "1 Main",
					estimatedMaterials: [],
					supervisorId: supId,
					status: "CANCELLED",
				},
			})
			for (const queue of SUPERVISOR_QUEUES) {
				const hit = await db.jafInvoice.count({
					where: { AND: [{ id: cancelled.id }, supervisorQueueWhere(queue)] },
				})
				expect(hit, queue).toBe(queue === "all" ? 1 : 0)
			}
		},
		HOOK_TIMEOUT,
	)
})
