/** The JAF invoice number: `M2026-` + the Aviso number, else the control number. */
export const invoiceNumberFor = (doc: {
	avisoNumber: string | null
	controlNumber: string
}) => `M2026-${doc.avisoNumber ?? doc.controlNumber}`
