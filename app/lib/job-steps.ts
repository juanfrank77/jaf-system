import type { Role } from "../../generated/prisma/client"

// The job's own lifecycle, in the order the work travels through
// it, as drawn on every job screen (mockup v3): the work order is
// created, the warehouse stages and releases the materials with
// both signatures, the crew works the job and the supervisor logs it, the
// warehouse receives what comes back, and supervisor + finance
// close it out. Every per-job screen renders a `JobStepRail`
// naming its step; which steps are "yours" depends on the login.
export type JobStep =
	| "CREATED"
	| "PREP"
	| "RELEASE"
	| "FIELD"
	| "RETURN"
	| "CLOSE"

export const JOB_STEPS: JobStep[] = [
	"CREATED",
	"PREP",
	"RELEASE",
	"FIELD",
	"RETURN",
	"CLOSE",
]

/** Route per step — the rail links a reached step back to its screen. */
export const JOB_STEP_HREF: Record<JobStep, (docId: string) => string> = {
	CREATED: (docId) => `/docs/${docId}`,
	PREP: (docId) => `/docs/${docId}/prep`,
	RELEASE: (docId) => `/docs/${docId}/sign`,
	FIELD: (docId) => `/docs/${docId}/field`,
	RETURN: (docId) => `/docs/${docId}/returns`,
	CLOSE: (docId) => `/docs/${docId}/review`,
}

/** i18n key per step, inside the `job_flow.step` namespace. */
export const JOB_STEP_LABEL_KEY = {
	CREATED: "job_flow.step.created",
	PREP: "job_flow.step.prep",
	RELEASE: "job_flow.step.release",
	FIELD: "job_flow.step.field",
	RETURN: "job_flow.step.return",
	CLOSE: "job_flow.step.close",
} as const

/** The steps a role owns — the rail's "You" marks. ADMIN oversees
 * every step but owns none, so nothing is bolded for it. */
const MINE_BY_ROLE: Partial<Record<Role, JobStep[]>> = {
	WAREHOUSE: ["PREP", "RELEASE", "RETURN"],
	SUPERVISOR: ["FIELD", "CLOSE"],
}

/** The roles that can open a step's screen. */
const ACCESS_BY_STEP: Record<JobStep, Role[]> = {
	CREATED: [
		"SUPERVISOR",
		"WAREHOUSE",
		"FINANCE",
		"INSTALLER",
		"COMPTROLLER",
		"INSTALLER_SUPERVISOR",
	],
	PREP: ["WAREHOUSE"],
	RELEASE: ["WAREHOUSE"],
	FIELD: ["SUPERVISOR"],
	RETURN: ["WAREHOUSE"],
	CLOSE: ["SUPERVISOR"],
}

export function isJobStepMine(role: Role, step: JobStep): boolean {
	return MINE_BY_ROLE[role]?.includes(step) ?? false
}

export function canViewJobStep(role: Role, step: JobStep): boolean {
	return role === "ADMIN" || ACCESS_BY_STEP[step].includes(role)
}
