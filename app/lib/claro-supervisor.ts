export type ClaroSupervisorValidation =
	| { ok: true }
	| {
			ok: false
			errorKey:
				| "claro_supervisors.errors.invalid_name"
				| "claro_supervisors.errors.invalid_email"
	  }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateClaroSupervisor(input: {
	name: string
	email: string
}): ClaroSupervisorValidation {
	if (!input.name.trim()) {
		return { ok: false, errorKey: "claro_supervisors.errors.invalid_name" }
	}
	if (!EMAIL_RE.test(input.email.trim())) {
		return { ok: false, errorKey: "claro_supervisors.errors.invalid_email" }
	}
	return { ok: true }
}
