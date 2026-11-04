export type AddressInput = {
	sector: string | null
	direccion1: string
	direccion2: string | null
	latitud: string | null
	longitud: string | null
	tipo: string
	ciudad: string | null
	tipoPlanta: string
	grupoPlan: string
}

function text(form: FormData, key: string): string {
	const v = form.get(key)
	return typeof v === "string" ? v.trim() : ""
}

function optional(form: FormData, key: string): string | null {
	return text(form, key) || null
}

export function parseAddressInput(
	form: FormData,
):
	| { ok: true; value: AddressInput }
	| { ok: false; errorKey: "docs_new.errors.address_required" } {
	const direccion1 = text(form, "direccion1")
	const tipo = text(form, "tipo")
	const tipoPlanta = text(form, "tipoPlanta")
	const grupoPlan = text(form, "grupoPlan")
	if (!direccion1 || !tipo || !tipoPlanta || !grupoPlan) {
		return { ok: false, errorKey: "docs_new.errors.address_required" }
	}
	return {
		ok: true,
		value: {
			sector: optional(form, "sector"),
			direccion1,
			direccion2: optional(form, "direccion2"),
			latitud: optional(form, "latitud"),
			longitud: optional(form, "longitud"),
			tipo,
			ciudad: optional(form, "ciudad"),
			tipoPlanta,
			grupoPlan,
		},
	}
}

export function composeJobAddress(
	a: Pick<AddressInput, "direccion1" | "sector">,
): string {
	return a.sector ? `${a.direccion1}, ${a.sector}` : a.direccion1
}
