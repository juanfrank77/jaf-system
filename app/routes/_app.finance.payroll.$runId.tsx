import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { isPayrollFallbackEnabled } from "~/lib/features.server"
import { validateFile } from "~/lib/file-upload.server"
import {
	buildJournalBlocks,
	closePayrollRun,
	closePayrollRunAccount,
	parsePaidDate,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import { saveUpload } from "~/lib/uploads.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.payroll.$runId"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll run — JAF Ops" },
]

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
	"finance_payroll.errors.future_date": "finance_payroll.errors.future_date",
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
	const [accountRows, jobCounts] = await Promise.all([
		db.payrollRunAccount.findMany({
			where: { payrollRunId: run.id },
			include: {
				contractorAccount: { select: { code: true, label: true } },
				paidBy: { select: { name: true } },
			},
		}),
		db.jafInvoice.groupBy({
			by: ["contractorAccountId"],
			where: { payrollRunId: run.id },
			_count: true,
		}),
	])
	const jobsByAccount = new Map(
		jobCounts.map((c) => [c.contractorAccountId, c._count]),
	)
	const accounts = accountRows
		.map((a) => ({
			accountId: a.contractorAccountId,
			code: a.contractorAccount.code,
			label: a.contractorAccount.label,
			jobs: jobsByAccount.get(a.contractorAccountId) ?? 0,
			paidAt: a.paidAt,
			paidByName: a.paidBy?.name ?? null,
			confirmedByFallback: a.confirmedByFallback,
		}))
		.sort((x, y) => x.code.localeCompare(y.code))
	return {
		user,
		run,
		blocks,
		accounts,
		fallbackEnabled: isPayrollFallbackEnabled(),
	}
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
				"Content-Disposition": `attachment; filename="journal-${run.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`,
			},
		})
	}

	if (intent === "confirm_account") {
		const accountId = form.get("accountId")
		if (typeof accountId !== "string" || !accountId) {
			return { errorKey: "finance_payroll.errors.missing_fields" }
		}
		const parsed = parsePaidDate(form.get("paidDate") as string | null)
		if ("errorKey" in parsed) return { errorKey: parsed.errorKey }
		try {
			await closePayrollRunAccount({
				runId: params.runId as string,
				accountId,
				paidById: user.id,
				paidDate: parsed.date,
				confirmedByFallback: true,
			})
		} catch (e) {
			// Already paid (double-click, stale tab): the account IS paid, so
			// show success. 403/404 and everything else still propagate.
			if (!(e instanceof Response && e.status === 409)) throw e
		}
		return { ok: true }
	}

	if (intent !== "batch_confirm")
		return { errorKey: "finance_payroll.errors.unknown_intent" }

	const parsed = parsePaidDate(form.get("paidDate") as string | null)
	if ("errorKey" in parsed) return { errorKey: parsed.errorKey }
	const paidDate = parsed.date

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

	try {
		await closePayrollRun({
			runId: params.runId as string,
			paidById: user.id,
			paidDate,
			evidencePath,
			confirmedByFallback: true,
		})
	} catch (e) {
		// The close was rejected (already closed, lost a race, ...): don't leave
		// the just-written evidence file orphaned on disk.
		if (evidencePath) await fs.unlink(evidencePath).catch(() => {})
		throw e
	}
	throw redirect("/finance/payroll")
}

export default function FinancePayrollRunDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { run, blocks, accounts, fallbackEnabled } = loaderData
	const fallbackCount = accounts.filter((a) => a.confirmedByFallback).length
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	const error = actionData?.errorKey
		? t(
				ERROR_KEYS[actionData.errorKey as ActionErrorKey] ??
					"finance_payroll.errors.unknown_intent",
			)
		: null
	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-bold">{run.label}</h1>
					<StageChip arm="A" step={4} total={5} />
				</div>
				<div className="flex items-center gap-4">
					<Link to="/finance/payroll" className="text-sm underline">
						{t("finance_payroll.back")}
					</Link>
					<Link to="/finance/awaiting-carmen" className="text-sm underline">
						{t("finance_payroll.see_carmen")}
					</Link>
				</div>
			</div>
			<FinanceStepRail current="LISTS" />
			<Callout title={t("finance_flow.callout.lists_title")}>
				{t("finance_flow.callout.lists_body")}
			</Callout>
			{run.paidAt ? (
				<Badge variant="ok">
					{t("finance_payroll.paid_on", {
						date: new Date(run.paidAt).toLocaleDateString(),
					})}
				</Badge>
			) : (
				<Badge variant="warn">{t("finance_payroll.open")}</Badge>
			)}

			{fallbackCount > 0 && (
				<p className="text-sm text-muted-foreground">
					{t("finance_payroll.fallback_count", { count: fallbackCount })}
				</p>
			)}

			{error && <p className="text-sm text-status-danger">{error}</p>}

			<Form method="post">
				<input type="hidden" name="intent" value="download_journal_pdf" />
				<Button type="submit" variant="secondary">
					{t("finance_payroll.download_journal_pdf")}
				</Button>
			</Form>

			<div className="overflow-x-auto bg-card border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-muted-foreground text-left border-b">
							<th className="p-2">{t("finance_payroll.col.brigade")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.gross")}
							</th>
							<th className="p-2 text-right">{t("finance_payroll.col.net")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.retention")}
							</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.total_sc")}
							</th>
						</tr>
					</thead>
					<tbody>
						{blocks.map((block) => (
							<tr key={block.brigadeCode} className="border-b last:border-0">
								<td className="p-2">
									<span className="font-mono">{block.brigadeCode}</span>{" "}
									<span className="text-muted-foreground">
										{block.brigadeLabel}
									</span>
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
									{formatMoney(block.totalSC)}
								</td>
							</tr>
						))}
						<tr className="font-semibold border-t">
							<td colSpan={5} className="p-2">
								{t("finance_payroll.grand_total")}
							</td>
						</tr>
						<tr className="border-t-2 border-foreground">
							<td className="p-2 font-mono">—</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(blocks.reduce((s, b) => s + b.gross, 0))}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(blocks.reduce((s, b) => s + b.net, 0))}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(blocks.reduce((s, b) => s + b.retention, 0))}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(blocks.reduce((s, b) => s + b.totalSC, 0))}
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div className="overflow-x-auto bg-card border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-muted-foreground text-left border-b">
							<th className="p-2">{t("finance_payroll.col.brigade")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.jobs")}
							</th>
							<th className="p-2">{t("finance_payroll.col.status")}</th>
						</tr>
					</thead>
					<tbody>
						{accounts.map((a) => (
							<tr key={a.accountId} className="border-b last:border-0">
								<td className="p-2">
									<span className="font-mono">{a.code}</span>{" "}
									<span className="text-muted-foreground">{a.label}</span>
								</td>
								<td className="p-2 text-right font-mono">{a.jobs}</td>
								<td className="p-2">
									{a.paidAt ? (
										<span className="flex flex-wrap items-center gap-2">
											<span>
												{t("finance_payroll.paid_by", {
													date: new Date(a.paidAt).toLocaleDateString(),
													name: a.paidByName ?? "—",
												})}
											</span>
											{a.confirmedByFallback && (
												<Badge variant="warn">
													{t("finance_payroll.from_paper")}
												</Badge>
											)}
										</span>
									) : (
										<span className="flex flex-wrap items-center gap-2">
											<span className="text-muted-foreground">
												{t("finance_payroll.awaiting_comptroller")}
											</span>
											{fallbackEnabled && (
												<Form method="post" className="flex items-center gap-1">
													<input
														type="hidden"
														name="intent"
														value="confirm_account"
													/>
													<input
														type="hidden"
														name="accountId"
														value={a.accountId}
													/>
													<input
														type="date"
														name="paidDate"
														required
														className="border rounded px-2 py-1 text-xs"
													/>
													<Button
														type="submit"
														variant="secondary"
														size="xs"
														disabled={submitting}
													>
														{t("finance_payroll.confirm_account")}
													</Button>
												</Form>
											)}
										</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{!run.paidAt && fallbackEnabled && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="bg-card border rounded-lg p-4 space-y-2"
				>
					<input type="hidden" name="intent" value="batch_confirm" />
					<h2 className="font-semibold text-sm">
						{t("finance_payroll.batch_confirm")}
					</h2>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<label className="flex items-center gap-1">
							{t("finance_payroll.paid_date")}
							<input
								type="date"
								name="paidDate"
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
