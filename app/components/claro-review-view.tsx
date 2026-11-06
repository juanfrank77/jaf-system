import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import {
	ClaroCheckList,
	GENERATE_FORM_ID,
	useFieldLabel,
} from "~/components/claro-check-list"
import { ClaroLinesEditor } from "~/components/claro-lines-editor"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	type ClaroDetailError,
	type ClaroPoView,
	checkRows,
	fieldsToFix,
	hasCheck,
	onlyDuplicateStops,
	type ReviewField,
} from "~/lib/claro-po-view"
import { HARD_STOPS } from "~/lib/po-reading"
import { cn, formatMoney } from "~/lib/utils"

function Field({
	name,
	value,
	invalid,
	readOnly,
	type = "text",
	step,
	list,
	hint,
}: {
	name: ReviewField
	value: string | number | null
	invalid: boolean
	readOnly: boolean
	type?: string
	step?: string
	list?: string
	hint?: string | null
}) {
	const fieldLabel = useFieldLabel()
	return (
		<div className="space-y-1">
			<Label htmlFor={`po-${name}`}>{fieldLabel(name)}</Label>
			<Input
				id={`po-${name}`}
				name={name}
				type={type}
				step={step}
				list={list}
				defaultValue={value ?? ""}
				disabled={readOnly}
				aria-invalid={invalid || undefined}
				className={cn(invalid && "border-status-danger")}
			/>
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	)
}

/** Every value the form shows, so a save that changes one remounts it. */
const formKey = (po: ClaroPoView) =>
	JSON.stringify([
		po.poNumber,
		po.poDate,
		po.avisoNumber,
		po.termsDays,
		po.statedPages,
		po.subtotal,
		po.ivu4,
		po.ivu115,
		po.total,
		po.lines,
	])

/**
 * Step 2, Review: the PO as read on the left, every field editable in place;
 * the checks and the source PDF on the right. A red check that can be
 * overridden takes a reason posted with Generate. Missing pages offer only
 * a complete upload; a duplicate offers the existing PO or a discard.
 */
export function ClaroReviewView({
	po,
	hasSignature,
	errorKey,
}: {
	po: ClaroPoView
	hasSignature: boolean
	errorKey?: ClaroDetailError
}) {
	const { t } = useTranslation()
	const nav = useNavigation()
	const busy = nav.state !== "idle"
	const [dirty, setDirty] = useState(false)
	// A save that came back clean leaves nothing unsaved.
	const saving = useRef(false)
	useEffect(() => {
		const now = nav.state !== "idle" && nav.formData?.get("intent") === "fix"
		if (saving.current && nav.state === "idle" && !errorKey) setDirty(false)
		saving.current = now
	}, [nav.state, nav.formData, errorKey])

	const readOnly = po.status === "CONFIRMED"
	const rows = checkRows(po.checks)
	const toFix = fieldsToFix(po.checks)
	const hardStop = po.checks.some((c) => HARD_STOPS.has(c.code))
	const pagesMissing = hasCheck(po.checks, "pages_missing")
	const duplicate = onlyDuplicateStops(po.checks)
	const unreadable = !!po.readError || hasCheck(po.checks, "unreadable")
	const canGenerate = !hardStop && !po.invoice
	const askReasons = canGenerate && !readOnly
	const printedHint = (k: "subtotal" | "ivu4" | "ivu115" | "total") => {
		const p = po.printed?.[k]
		const s = po[k]
		return p !== null &&
			p !== undefined &&
			(s === null || p.toFixed(2) !== s.toFixed(2))
			? t("claro.review.printed", { amount: formatMoney(p) })
			: null
	}
	const fileUrl = `/finance/claro/${po.id}/file`

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="font-semibold">
					{t("po_inbox.po_title", { number: po.poNumber ?? po.fileName })}
				</h2>
				<Link to="/finance/claro" className="text-sm underline">
					{t("claro.back_to_queue")}
				</Link>
			</div>
			{errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(errorKey)}
				</p>
			)}
			<div className="grid gap-4 lg:grid-cols-2">
				<section
					aria-labelledby="claro-as-read"
					className="space-y-3 rounded-lg border bg-card p-3"
				>
					<h2 id="claro-as-read" className="text-sm font-semibold">
						{t("claro.review.as_read")}
					</h2>
					{unreadable && (
						<p className="text-sm text-status-warn">
							{t("po_inbox.read_failed")}
						</p>
					)}
					<Form
						key={formKey(po)}
						method="post"
						className="space-y-3"
						onChange={() => setDirty(true)}
					>
						<input type="hidden" name="intent" value="fix" />
						<div className="grid grid-cols-2 gap-3">
							<Field
								name="poNumber"
								value={po.poNumber}
								invalid={toFix.has("poNumber")}
								readOnly={readOnly}
							/>
							<Field
								name="poDate"
								type="date"
								value={po.poDate}
								invalid={toFix.has("poDate")}
								readOnly={readOnly}
							/>
							<Field
								name="avisoNumber"
								value={po.avisoNumber}
								list="claro-aviso-candidates"
								invalid={toFix.has("avisoNumber")}
								readOnly={readOnly}
								hint={
									po.avisoCandidates.length > 0
										? t("claro.review.candidates", {
												numbers: po.avisoCandidates.join(", "),
											})
										: !po.avisoNumber
											? t("po_inbox.no_aviso")
											: null
								}
							/>
							<datalist id="claro-aviso-candidates">
								{po.avisoCandidates.map((c) => (
									<option key={c} value={c} />
								))}
							</datalist>
							<Field
								name="termsDays"
								type="number"
								step="1"
								value={po.termsDays}
								invalid={toFix.has("termsDays")}
								readOnly={readOnly}
							/>
							<Field
								name="statedPages"
								type="number"
								step="1"
								value={po.statedPages}
								invalid={toFix.has("statedPages")}
								readOnly={readOnly}
								hint={t("claro.review.file_pages", {
									count: po.filePages ?? 0,
								})}
							/>
						</div>
						<div className="space-y-1">
							<p className="text-sm font-medium">{t("claro.review.lines")}</p>
							<ClaroLinesEditor
								lines={po.lines}
								readOnly={readOnly}
								invalid={toFix.has("lines")}
								onEdit={() => setDirty(true)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							{(["subtotal", "ivu4", "ivu115", "total"] as const).map((k) => (
								<Field
									key={k}
									name={k}
									type="number"
									step="0.01"
									value={po[k]}
									invalid={toFix.has(k)}
									readOnly={readOnly}
									hint={printedHint(k)}
								/>
							))}
						</div>
						{po.avisoNumber && po.billed !== null && (
							<p className="text-sm">
								{t("po_inbox.aviso_money", {
									billed: formatMoney(po.billed),
									already: formatMoney(po.alreadyPod),
									thisPo: formatMoney(po.subtotal ?? 0),
								})}
							</p>
						)}
						{!readOnly && (
							<Button type="submit" variant="secondary" disabled={busy}>
								{t("claro.review.save")}
							</Button>
						)}
					</Form>
				</section>

				<div className="space-y-3">
					<ClaroCheckList rows={rows} askReasons={askReasons} />

					{pagesMissing && (
						<Callout tone="danger" title={t("claro.review.pages_title")}>
							{t("claro.review.pages_body")}
							<Form
								method="post"
								encType="multipart/form-data"
								className="mt-2 flex flex-wrap items-center gap-2"
							>
								<input type="hidden" name="intent" value="upload_complete" />
								<input
									type="file"
									name="file"
									accept="application/pdf,.pdf"
									required
									aria-label={t("claro.review.complete_file")}
									className="text-sm"
								/>
								<Button type="submit" disabled={busy}>
									{t("claro.review.upload_complete")}
								</Button>
							</Form>
						</Callout>
					)}

					{duplicate && (
						<Callout tone="danger" title={t("claro.review.duplicate_title")}>
							{t("claro.review.duplicate_body")}
							<div className="mt-2 flex flex-wrap items-center gap-2">
								{po.original && (
									<Link
										to={`/finance/claro/${po.original.id}`}
										className={buttonVariants({
											variant: "outline",
											size: "sm",
										})}
									>
										{t("claro.review.open_original")}
									</Link>
								)}
								<Form method="post">
									<input type="hidden" name="intent" value="discard" />
									<Button
										type="submit"
										variant="destructive"
										size="sm"
										disabled={busy}
									>
										{t("claro.review.discard")}
									</Button>
								</Form>
							</div>
						</Callout>
					)}

					{unreadable && !readOnly && (
						<Form method="post">
							<input type="hidden" name="intent" value="reread" />
							<Button type="submit" variant="outline" disabled={busy}>
								{t("po_inbox.reread")}
							</Button>
						</Form>
					)}

					{canGenerate && (
						<Form
							id={GENERATE_FORM_ID}
							method="post"
							className="space-y-2 rounded-lg border bg-card p-3"
						>
							<input type="hidden" name="intent" value="generate" />
							<div className="space-y-1">
								<Label htmlFor="claro-work-month">
									{t("claro_invoices.col.work_month")}
								</Label>
								<Input
									id="claro-work-month"
									name="workMonth"
									type="month"
									required
									defaultValue={po.suggestedMonth ?? ""}
									className="w-44"
								/>
							</div>
							{rows.some((r) => r.overridable.length > 0) && !readOnly && (
								<p className="text-xs text-muted-foreground">
									{t("claro.review.reasons_needed")}
								</p>
							)}
							{dirty && (
								<p className="text-xs text-status-warn">
									{t("claro.review.save_first")}
								</p>
							)}
							{!hasSignature && (
								<p className="text-xs text-status-danger">
									{t("claro_invoices.errors.no_signature")}
								</p>
							)}
							<Button type="submit" disabled={busy || dirty || !hasSignature}>
								{t("claro.review.generate")}
							</Button>
						</Form>
					)}
					{po.invoice && (
						<Link
							to={`/finance/claro/${po.id}?step=generate`}
							className={buttonVariants({ variant: "outline" })}
						>
							{t("claro.review.open_invoice", { number: po.invoice.number })}
						</Link>
					)}

					<object
						data={fileUrl}
						type="application/pdf"
						aria-label={t("po_inbox.image")}
						className="h-[75vh] w-full rounded-lg border"
					>
						<a href={fileUrl} className="underline">
							{t("po_inbox.open_file")}
						</a>
					</object>
				</div>
			</div>
		</div>
	)
}
