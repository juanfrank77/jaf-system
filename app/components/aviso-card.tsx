import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import { Textarea } from "~/components/ui/textarea"
import type { AvisoDiscrepancy } from "~/lib/aviso-discrepancy"
import type { MaterialDifference } from "~/lib/aviso-materials"

/**
 * What `save_aviso` / `replace_aviso` returned: an error (with both numbers on
 * a mismatch, or the differing material lines), a note, or an info message.
 */
type AvisoResult = {
	errorKey?: string
	errorMessage?: string
	noteKey?: string
	info?: string
	typedNumber?: string
	pdfAvisoNumber?: string
	differences?: MaterialDifference[]
} | null

/** A replaced Aviso, kept viewable and marked "replaced" (never used). */
export type AvisoHistoryRow = {
	avisoNumber: string | null
	href: string
	reason: string
	replacedAt: string
}

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
	/** The open materials discrepancy on the saved Aviso, if any. */
	discrepancy?: AvisoDiscrepancy | null
	history?: AvisoHistoryRow[]
	/** Replace Aviso is open (saved, no Pre-cert signature, limit not used). */
	canReplace?: boolean
	/** The job's one replacement has been used. */
	replaceUsed?: boolean
	/** Where "Continue to Pre-cert" goes once the Aviso is saved. */
	continueHref?: string | null
	/** Extra controls rendered under the form (e.g. the optional Claro PDF). */
	children?: React.ReactNode
}

function DifferenceList({
	differences,
}: {
	differences: MaterialDifference[]
}) {
	const { t } = useTranslation()
	return (
		<ul className="list-disc space-y-0.5 pl-5 text-sm">
			{differences.map((d) => (
				<li key={d.claroCode}>
					{t("docs_review.aviso_difference", {
						name: d.name,
						workOrder: d.workOrder,
						aviso: d.aviso,
					})}
				</li>
			))}
		</ul>
	)
}

/** The note that lets the job continue with a difference (required). */
function ContinueWithNote() {
	const { t } = useTranslation()
	const [note, setNote] = useState("")
	return (
		<div className="space-y-2">
			<Label htmlFor="discrepancyNote" className="text-xs">
				{t("docs_review.aviso_discrepancy_note_label")}
			</Label>
			<Textarea
				id="discrepancyNote"
				name="discrepancyNote"
				rows={2}
				value={note}
				onChange={(e) => setNote(e.target.value)}
			/>
			<Button
				type="submit"
				variant="outline"
				disabled={note.trim() === ""}
				className="w-full"
			>
				{t("docs_review.aviso_continue_anyway")}
			</Button>
		</div>
	)
}

function ResultMessages({ result }: { result: AvisoResult }) {
	const { t } = useTranslation()
	return (
		<>
			{result?.noteKey && (
				<Pill variant="info" icon="ℹ">
					{t(result.noteKey as ParseKeys)}
				</Pill>
			)}
			{result?.info && (
				<Pill variant="info" icon="ℹ">
					{t(result.info as ParseKeys)}
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
		</>
	)
}

/**
 * Step 6 · Aviso. The supervisor types the Aviso number and uploads the Aviso
 * PDF; the hard check is that the number on the file is the typed one. Then
 * the materials table is compared with the work order, best effort: differing
 * lines need a note to continue, an unreadable table only says so. Once saved,
 * the Aviso can be replaced once (with a reason) until the Pre-cert is signed.
 */
export function AvisoCard({
	docId,
	avisoNumber,
	avisoDocPath,
	saved,
	locked,
	readOnly,
	result,
	discrepancy = null,
	history = [],
	canReplace = false,
	replaceUsed = false,
	continueHref = null,
	children,
}: Props) {
	const { t } = useTranslation()
	const [pickedFile, setPickedFile] = useState<string | null>(null)
	const savedName = avisoDocPath?.split(/[\\/]/).pop() ?? null
	const fileName = pickedFile ?? savedName

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
			<CardContent className="space-y-4">
				{saved ? (
					<>
						<div className="grid gap-3 sm:grid-cols-2">
							<div>
								<p className="text-xs text-muted-foreground">
									{t("docs_review_steps.aviso_number_label")}
								</p>
								<p className="mt-1 font-mono">{avisoNumber}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">
									{t("docs_review_steps.aviso_pdf_label")}
								</p>
								<p className="mt-1 flex items-center gap-2 text-sm">
									<span aria-hidden="true">📎</span>
									<a
										href={`/files/aviso-docs/${docId}-aviso.pdf`}
										className="truncate text-accent-text underline"
									>
										{savedName}
									</a>
								</p>
							</div>
						</div>
						{avisoNumber && (
							<Pill variant="ok" icon="✓">
								{t("docs_review_steps.aviso_saved", { number: avisoNumber })}
							</Pill>
						)}
						{discrepancy && (
							<div className="space-y-2 rounded-lg border border-status-warn p-3">
								<p className="flex gap-1 text-sm font-semibold">
									<span aria-hidden="true">⚠</span>
									<span>{t("docs_review.aviso_discrepancy_title")}</span>
								</p>
								<p className="text-xs text-muted-foreground">
									{t("docs_review.aviso_discrepancy_body")}
								</p>
								<DifferenceList differences={discrepancy.differences} />
								{discrepancy.note ? (
									<p className="text-sm">
										{t("docs_review.aviso_discrepancy_note", {
											note: discrepancy.note,
										})}
									</p>
								) : (
									!readOnly &&
									!locked && (
										<Form method="post">
											<input type="hidden" name="intent" value="save_aviso" />
											<input
												type="hidden"
												name="avisoNumber"
												value={avisoNumber ?? ""}
											/>
											<ContinueWithNote />
										</Form>
									)
								)}
							</div>
						)}
						<ResultMessages result={result} />
						{result?.differences && result.differences.length > 0 && (
							<DifferenceList differences={result.differences} />
						)}
						{history.length > 0 && (
							<div>
								<h3 className="text-xs font-semibold text-muted-foreground">
									{t("docs_review.aviso_history_heading")}
								</h3>
								<ul className="mt-1 space-y-1 text-sm">
									{history.map((h) => (
										<li key={h.href} className="text-muted-foreground">
											<a href={h.href} className="underline">
												{t("docs_review.aviso_history_number", {
													number: h.avisoNumber ?? "—",
												})}
											</a>{" "}
											·{" "}
											{t("docs_review.aviso_history_replaced", {
												date: new Date(h.replacedAt).toLocaleDateString(),
												reason: h.reason,
											})}
										</li>
									))}
								</ul>
							</div>
						)}
						{!readOnly && canReplace && (
							<details className="rounded-lg border p-3">
								<summary className="cursor-pointer text-sm font-semibold">
									{t("docs_review.aviso_replace_heading")}
								</summary>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("docs_review.aviso_replace_hint")}
								</p>
								<Form
									method="post"
									encType="multipart/form-data"
									className="mt-3 space-y-3"
								>
									<input type="hidden" name="intent" value="replace_aviso" />
									<div className="grid gap-3 sm:grid-cols-2">
										<div>
											<Label htmlFor="replaceAvisoNumber" className="text-xs">
												{t("docs_review_steps.aviso_number_label")}
											</Label>
											<Input
												id="replaceAvisoNumber"
												name="avisoNumber"
												inputMode="numeric"
												required
												className="mt-1 font-mono"
											/>
										</div>
										<div>
											<Label htmlFor="replaceAvisoPdf" className="text-xs">
												{t("docs_review_steps.aviso_pdf_label")}
											</Label>
											<Input
												id="replaceAvisoPdf"
												type="file"
												name="avisoPdf"
												accept="application/pdf"
												required
												className="mt-1"
											/>
										</div>
									</div>
									<div>
										<Label htmlFor="replaceReason" className="text-xs">
											{t("docs_review.aviso_replace_reason_label")}
										</Label>
										<Textarea
											id="replaceReason"
											name="replaceReason"
											rows={2}
											required
											className="mt-1"
										/>
									</div>
									<Button type="submit" variant="outline" className="w-full">
										{t("docs_review.aviso_replace_submit")}
									</Button>
								</Form>
							</details>
						)}
						{!readOnly && !canReplace && replaceUsed && (
							<p className="text-xs text-muted-foreground">
								{t("docs_review.aviso_replace_used")}
							</p>
						)}
						{!readOnly && continueHref && (
							<Link
								to={continueHref}
								className={buttonVariants({ className: "w-full" })}
							>
								{t("docs_review.aviso_continue_precert")}
							</Link>
						)}
					</>
				) : (
					<Form
						method="post"
						encType="multipart/form-data"
						className="space-y-4"
					>
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
											<span className="truncate">{fileName}</span>
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

							<ResultMessages result={result} />
							{result?.differences && result.differences.length > 0 && (
								<>
									<DifferenceList differences={result.differences} />
									{!readOnly && <ContinueWithNote />}
								</>
							)}

							{!readOnly && (
								<Button type="submit" disabled={locked} className="w-full">
									{t("docs_review_steps.aviso_save")}
								</Button>
							)}
						</fieldset>
					</Form>
				)}
				{!readOnly && (
					<Link
						to="?step=INVOICE"
						className={buttonVariants({
							variant: "ghost",
							className: "w-full",
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
