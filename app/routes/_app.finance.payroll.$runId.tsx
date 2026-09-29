import { randomUUID } from "node:crypto"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { buildJournalBlocks, closePayrollRun } from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import { saveUpload } from "~/lib/uploads.server"
import { formatMoney } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.finance.payroll.$runId"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll run — JAF Ops" },
]

const INVOICE_SELECT = {
	id: true,
	controlNumber: true,
	avisoNumber: true,
	grossPayable: true,
	retentionAmount: true,
	netPayable: true,
	contractorAccount: {
		select: {
			id: true,
			code: true,
			label: true,
			winpayEmployeeCode: true,
			isPlaceholder: true,
		},
	},
} as const

/**
 * A run's invoices, in the ONE order the journal is ever rendered in.
 *
 * `buildJournalBlocks` accumulates `adjNetRunning` across blocks in first-seen
 * order, so the order of this relation decides the block order and therefore
 * every value in the "Adj. net (running)" column. Without an explicit
 * `orderBy`, Postgres returns rows in whatever order the plan happens to
 * produce — which can differ between two page loads of the same run, and
 * between the screen and a PDF printed from it. That column is what finance
 * reconciles against, so a shifting total is a correctness problem.
 *
 * `releasedToFinanceAt` alone is not a total order: a batch of jobs is
 * released together, so ties would still reorder. `id` is the tiebreaker.
 *
 * Shared by the loader and the PDF branch on purpose — the printed journal has
 * to agree with the screen, and a duplicated literal is how they would drift.
 */
const RUN_INVOICES = {
	select: INVOICE_SELECT,
	orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
} satisfies Prisma.PayrollRun$invoicesArgs

/**
 * `validateFile(file, "file")` only enforces blocked extensions and the 40MB
 * cap — unlike its "pdf"/"photo" branches it does NOT check MIME type. Evidence
 * for a payroll close is a scanned ACH confirmation, so the accepted types are
 * checked explicitly here; otherwise an executable renamed to .pdf would pass.
 */
const ALLOWED_EVIDENCE_MIME = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const

type EvidenceMime = (typeof ALLOWED_EVIDENCE_MIME)[number]

/** `Array.includes` does not narrow, so gate the MIME through a real guard. */
function isEvidenceMime(value: string): value is EvidenceMime {
	return (ALLOWED_EVIDENCE_MIME as readonly string[]).includes(value)
}

/** Extension for each allow-listed MIME — never taken from the client filename. */
const EVIDENCE_MIME_EXT: Record<EvidenceMime, string> = {
	"application/pdf": ".pdf",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
}

/**
 * `t()` is keyed by a strict literal union of the locale resources, so the
 * action's `errorKey` strings are mapped to their known keys here rather than
 * interpolated into `t()`.
 */
const ERROR_KEYS = {
	"finance_payroll.errors.unknown_intent":
		"finance_payroll.errors.unknown_intent",
	"finance_payroll.errors.missing_fields":
		"finance_payroll.errors.missing_fields",
	"finance_payroll.errors.invalid_date": "finance_payroll.errors.invalid_date",
	"finance_payroll.errors.invalid_evidence":
		"finance_payroll.errors.invalid_evidence",
} as const

type ActionErrorKey = keyof typeof ERROR_KEYS

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const run = await db.payrollRun.findUniqueOrThrow({
		where: { id: params.runId },
		include: { invoices: RUN_INVOICES },
	})
	const blocks = buildJournalBlocks(run.invoices)
	return { user, run, blocks }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "download_journal_pdf") {
		const run = await db.payrollRun.findUniqueOrThrow({
			where: { id: params.runId },
			include: { invoices: RUN_INVOICES },
		})
		const blocks = buildJournalBlocks(run.invoices)
		const bytes = await generateProductionJournalPdf(run, blocks)
		return new Response(new Uint8Array(bytes), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="journal-${run.label}.pdf"`,
			},
		})
	}

	if (intent !== "batch_confirm")
		return { errorKey: "finance_payroll.errors.unknown_intent" }

	const achDateRaw = (form.get("achDate") as string | null)?.trim()
	if (!achDateRaw) {
		return { errorKey: "finance_payroll.errors.missing_fields" }
	}
	const achDate = new Date(achDateRaw)
	if (Number.isNaN(achDate.getTime())) {
		return { errorKey: "finance_payroll.errors.invalid_date" }
	}

	let evidencePath: string | null = null
	const evidence = form.get("evidence")
	if (evidence instanceof File && evidence.size > 0) {
		const validation = validateFile(evidence, "file")
		if (!validation.valid) {
			return { errorKey: "finance_payroll.errors.invalid_evidence" }
		}
		if (!isEvidenceMime(evidence.type)) {
			return { errorKey: "finance_payroll.errors.invalid_evidence" }
		}
		// Prove the run exists BEFORE writing anything to disk — otherwise a
		// request naming a non-existent run still leaves a file behind.
		const targetRun = await db.payrollRun.findUnique({
			where: { id: params.runId as string },
			select: { id: true },
		})
		if (!targetRun) {
			throw new Response("Not Found", { status: 404 })
		}
		// The on-disk name is derived from the run id and a random UUID, never
		// from `evidence.name`: that name is client-controlled, and
		// `path.join` normalises `..` segments straight out of the upload dir
		// (`../../../../tmp/x.pdf` resolves outside it). The extension comes
		// from the already-allow-listed MIME, not from the client either. This
		// matches the sanitising done by the other two upload sites
		// (`_app.docs.$id_.field.tsx`, `_app.installer.completion.new.tsx`).
		// `files.$.tsx` still resolves the run id from the `<runId>-` prefix.
		const ext = EVIDENCE_MIME_EXT[evidence.type as EvidenceMime]
		evidencePath = await saveUpload(
			"payroll-runs",
			`${targetRun.id}-${randomUUID()}${ext}`,
			evidence,
		)
	}

	await closePayrollRun({
		runId: params.runId as string,
		paidById: user.id,
		achDate,
		evidencePath,
		confirmedByFallback: true,
	})
	throw redirect("/finance/payroll")
}

export default function FinancePayrollRunDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { run, blocks } = loaderData
	const { t } = useTranslation()
	const error = actionData?.errorKey
		? t(
				ERROR_KEYS[actionData.errorKey as ActionErrorKey] ??
					"finance_payroll.errors.unknown_intent",
			)
		: null
	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{run.label}</h1>
				<Link to="/finance/payroll" className="text-sm underline">
					{t("finance_payroll.back")}
				</Link>
			</div>
			{run.paidAt ? (
				<Badge variant="ok">
					{t("finance_payroll.paid_on", {
						date: new Date(run.paidAt).toLocaleDateString(),
					})}
				</Badge>
			) : (
				<Badge variant="warn">{t("finance_payroll.open")}</Badge>
			)}

			{error && <p className="text-sm text-red-600">{error}</p>}

			<Form method="post">
				<input type="hidden" name="intent" value="download_journal_pdf" />
				<Button type="submit" variant="secondary">
					{t("finance_payroll.download_journal_pdf")}
				</Button>
			</Form>

			<div className="overflow-x-auto bg-white border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-slate-500 text-left border-b">
							<th className="p-2">{t("finance_payroll.col.acct")}</th>
							<th className="p-2">{t("finance_payroll.col.contractor")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.gross")}
							</th>
							<th className="p-2 text-right">{t("finance_payroll.col.net")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.retention")}
							</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.adj_net")}
							</th>
						</tr>
					</thead>
					<tbody>
						{blocks.map((block) => (
							<tr
								key={block.contractorAccountId}
								className="border-b last:border-0"
							>
								<td className="p-2 font-mono">{block.accountCode}</td>
								<td className="p-2">
									{block.contractorLabel}
									{block.winpayEmployeeCode ? (
										<span className="ml-1 text-xs text-slate-500">
											{block.winpayEmployeeCode}
											{block.isPlaceholder && (
												<Badge variant="warn">
													{t("finance_payroll.placeholder")}
												</Badge>
											)}
										</span>
									) : null}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(block.gross)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(block.net)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(block.retention)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(block.adjNetRunning)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{!run.paidAt && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="bg-white border rounded-lg p-4 space-y-2"
				>
					<input type="hidden" name="intent" value="batch_confirm" />
					<h2 className="font-semibold text-sm">
						{t("finance_payroll.batch_confirm")}
					</h2>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<label className="flex items-center gap-1">
							{t("finance_payroll.ach_date")}
							<input
								type="date"
								name="achDate"
								required
								className="border rounded px-2 py-1"
							/>
						</label>
						<label className="flex items-center gap-1">
							{t("finance_payroll.evidence")}
							<input type="file" name="evidence" className="text-sm" />
						</label>
					</div>
					<Button type="submit">
						{t("finance_payroll.batch_confirm_submit")}
					</Button>
				</Form>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
