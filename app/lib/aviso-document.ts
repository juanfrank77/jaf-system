// The PDF that lets Finance bill a job is the Aviso uploaded in step 6
// (`avisoDocPath`). Jobs that went through the earlier flow stored Claro's
// work-order PDF in `claroPdfPath` instead, so that field is read as a
// fallback; nothing writes to it any more. Release and billing both ask this
// one function, so they cannot disagree about whether the document is there.
type AvisoDocFields = {
	avisoDocPath?: string | null
	claroPdfPath?: string | null
}

const present = (path: string | null | undefined) =>
	!!path && path.trim() !== ""

export function hasAvisoPdf(doc: AvisoDocFields): boolean {
	return present(doc.avisoDocPath) || present(doc.claroPdfPath)
}

/** URL of the job's Aviso PDF (or the legacy Claro one), or null when missing. */
export function avisoPdfUrl(
	doc: AvisoDocFields & { id: string },
): string | null {
	if (present(doc.avisoDocPath)) return `/files/aviso-docs/${doc.id}-aviso.pdf`
	if (present(doc.claroPdfPath)) return `/files/claro-pdfs/${doc.id}-claro.pdf`
	return null
}
