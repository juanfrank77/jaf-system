import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"

/** What `save_aviso` returned: an error (with both numbers on a mismatch) or a note. */
type AvisoResult = {
	errorKey?: string
	errorMessage?: string
	noteKey?: string
	typedNumber?: string
	pdfAvisoNumber?: string
} | null

type Props = {
	docId: string
	avisoNumber: string | null
	avisoDocPath: string | null
	/** Number + file on record (`isAvisoSaved`). */
	saved: boolean
	/** Released to Finance: nothing can change. */
	locked: boolean
	readOnly: boolean
	result: AvisoResult
	/** Extra controls rendered under the form (e.g. the optional Claro PDF). */
	children?: React.ReactNode
}

/**
 * Step 6 · Aviso. The supervisor types the Aviso number and uploads the Aviso
 * PDF; the only check is that the number on the file is the typed one. No line
 * match, no quantities, no amounts (spec F2).
 */
export function AvisoCard({
	docId,
	avisoNumber,
	avisoDocPath,
	saved,
	locked,
	readOnly,
	result,
	children,
}: Props) {
	const { t } = useTranslation()
	const [pickedFile, setPickedFile] = useState<string | null>(null)
	const fileName = pickedFile ?? avisoDocPath?.split(/[\\/]/).pop() ?? null

	return (
		<Card>
			<CardHeader className="items-start">
				<div>
					<h2 className="text-base font-bold">
						{t("docs_review_steps.aviso_heading")}
					</h2>
					<p className="mt-0.5 text-xs font-normal text-muted-foreground">
						{t("docs_review_steps.aviso_note")}
					</p>
				</div>
			</CardHeader>
			<CardContent>
				<Form method="post" encType="multipart/form-data" className="space-y-4">
					<fieldset disabled={readOnly} className="min-w-0 space-y-4">
						<input type="hidden" name="intent" value="save_aviso" />
						<div className="grid gap-3 sm:grid-cols-2">
							<div>
								<Label htmlFor="avisoNumber" className="text-xs">
									{t("docs_review_steps.aviso_number_label")}
								</Label>
								<Input
									id="avisoNumber"
									name="avisoNumber"
									defaultValue={avisoNumber ?? ""}
									inputMode="numeric"
									required
									className="mt-1 font-mono"
								/>
							</div>
							<div>
								<Label htmlFor="avisoPdf" className="text-xs">
									{t("docs_review_steps.aviso_pdf_label")}
								</Label>
								<div className="mt-1 flex min-h-9 items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm">
									<span aria-hidden="true">📎</span>
									{fileName ? (
										pickedFile || !avisoDocPath ? (
											<span className="truncate">{fileName}</span>
										) : (
											<a
												href={`/files/aviso-docs/${docId}-aviso.pdf`}
												className="truncate text-accent-text underline"
											>
												{fileName}
											</a>
										)
									) : (
										<span className="text-muted-foreground">
											{t("docs_review_steps.aviso_doc_empty")}
										</span>
									)}
									{!readOnly && (
										<label
											htmlFor="avisoPdf"
											className="ml-auto shrink-0 cursor-pointer text-xs font-semibold text-status-ok underline"
										>
											{avisoDocPath
												? t("docs_review_steps.replace")
												: t("docs_review_steps.choose_file")}
										</label>
									)}
									<input
										id="avisoPdf"
										type="file"
										name="avisoPdf"
										accept="application/pdf"
										className="sr-only"
										onChange={(e) =>
											setPickedFile(e.target.files?.[0]?.name ?? null)
										}
									/>
								</div>
							</div>
						</div>

						{saved && avisoNumber && !pickedFile && (
							<Pill variant="ok" icon="✓">
								{t("docs_review_steps.aviso_saved", { number: avisoNumber })}
							</Pill>
						)}
						{result?.noteKey && (
							<Pill variant="info" icon="ℹ">
								{t(result.noteKey as ParseKeys)}
							</Pill>
						)}
						{result?.errorMessage ? (
							<p role="alert" className="text-sm text-status-danger">
								{result.errorMessage}
							</p>
						) : result?.errorKey ? (
							<p role="alert" className="text-sm text-status-danger">
								{t(result.errorKey as ParseKeys, {
									typedNumber: result.typedNumber,
									pdfNumber: result.pdfAvisoNumber,
								})}
							</p>
						) : null}

						{!readOnly && (
							<Button type="submit" disabled={locked} className="w-full">
								{t("docs_review_steps.aviso_save")}
							</Button>
						)}
					</fieldset>
				</Form>
				{!readOnly && (
					<Link
						to="?step=INVOICE"
						className={buttonVariants({
							variant: "ghost",
							className: "mt-2 w-full",
						})}
					>
						← {t("docs_review_steps.aviso_back")}
					</Link>
				)}
				{children}
			</CardContent>
		</Card>
	)
}
