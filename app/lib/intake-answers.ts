// The two intake choices a supervisor must make before a work order exists:
// do the materials come from the warehouse (and if not, why), and does Claro
// need a Prefield. Both are stored on the job; later steps read the stored
// answers, never the Claro supervisor's `requiresPrefield` tag (that tag only
// pre-selects the Prefield choice on the form).

export type IntakeAnswers = {
	materialsFromWarehouse: boolean
	materialsReason: string | null
	prefieldNeeded: boolean
}

export type IntakeErrorKey =
	| "docs_new.errors.materials_choice_required"
	| "docs_new.errors.materials_reason_required"
	| "docs_new.errors.prefield_choice_required"

/** Form values for the materials-source radio group. */
export type MaterialsChoice = "yes" | "no"
/** Form values for the Prefield radio group. */
export type PrefieldChoice = "needed" | "not_needed"

function text(form: FormData, key: string): string {
	const v = form.get(key)
	return typeof v === "string" ? v.trim() : ""
}

export function parseIntakeAnswers(
	form: FormData,
):
	| { ok: true; value: IntakeAnswers }
	| { ok: false; errorKey: IntakeErrorKey } {
	const materials = text(form, "materialsFromWarehouse")
	if (materials !== "yes" && materials !== "no")
		return { ok: false, errorKey: "docs_new.errors.materials_choice_required" }
	const reason = text(form, "materialsReason")
	if (materials === "no" && !reason)
		return { ok: false, errorKey: "docs_new.errors.materials_reason_required" }
	const prefield = text(form, "prefieldNeeded")
	if (prefield !== "needed" && prefield !== "not_needed")
		return { ok: false, errorKey: "docs_new.errors.prefield_choice_required" }
	return {
		ok: true,
		value: {
			materialsFromWarehouse: materials === "yes",
			materialsReason: materials === "no" ? reason : null,
			prefieldNeeded: prefield === "needed",
		},
	}
}

/** The Prefield choice pre-selected for a Claro supervisor ("" = none chosen). */
export function prefieldChoiceFor(
	claro: { requiresPrefield: boolean } | undefined,
): PrefieldChoice | "" {
	if (!claro) return ""
	return claro.requiresPrefield ? "needed" : "not_needed"
}
