import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerStepper } from "~/components/installer-stepper"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	addPo,
	CLARO_ELIGIBLE,
	ClaroInstallerError,
	type ClaroStage,
	claroFilterMatches,
	claroRowView,
	markAribaSent,
	parseClaroFilter,
} from "~/lib/claro-installer.server"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { rematchJaLines } from "~/lib/payment-advice.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.claro.invoices"

export const meta: Route.MetaFunction = () => [
	{ title: "Claro invoices — JAF Ops" },
]

const E = "installers.claro_invoices.errors"
const STAGES: ClaroStage[] = [
	"no_po",
	"ready_for_ariba",
	"sent",
	"short",
	"paid",
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const rows = await db.ewitInvoice.findMany({
		where: CLARO_ELIGIBLE,
		include: { batch: { select: { sentAt: true } } },
		orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
		take: 500,
	})
	const now = new Date()
	const filter = parseClaroFilter(
		new URL(request.url).searchParams.get("stage"),
	)
	const view = rows
		.map((i) => claroRowView(i, now))
		.filter((r) => !filter || claroFilterMatches(filter, r))
	return { rows: view, filter, today: now.toISOString().slice(0, 10) }
}

/** "YYYY-MM-DD" at noon UTC, or null for anything that is not a real calendar day. */
function parseDay(v: FormDataEntryValue | null): Date | null {
	const text = String(v ?? "")
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
	const d = new Date(`${text}T12:00:00Z`)
	return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text
		? null
		: d
}

/** Every id is a live invoice already sent to PBCC (the same filter the page lists). */
async function allEligible(ids: string[]) {
	const unique = [...new Set(ids)]
	return (
		(await db.ewitInvoice.count({
			where: { id: { in: unique }, ...CLARO_ELIGIBLE },
		})) === unique.length
	)
}

type Fail = {
	errorKey: string
	expected?: string
	rate?: string
	detail?: string
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "add_po") {
			const file = form.get("poFile")
			const invoiceId = String(form.get("invoiceId") ?? "")
			const poNumber = String(form.get("poNumber") ?? "").trim()
			const poDate = parseDay(form.get("poDate"))
			const reprintTotal = Number(
				String(form.get("reprintTotal") ?? "").replace(/[$,\s]/g, ""),
			)
			const rateText = String(form.get("ivuRate") ?? "").trim()
			const ratePct = rateText === "" ? 4 : Number(rateText)
			if (
				!invoiceId ||
				!poNumber ||
				!poDate ||
				!(reprintTotal > 0) ||
				!Number.isFinite(reprintTotal) ||
				!(ratePct >= 0 && ratePct <= 20)
			)
				return { errorKey: `${E}.bad_input` } satisfies Fail
			if (!(file instanceof File) || file.size === 0)
				return { errorKey: `${E}.no_file` } satisfies Fail
			if (!validateFile(file, "pdf").valid)
				return { errorKey: `${E}.not_pdf` } satisfies Fail
			if (!(await allEligible([invoiceId])))
				return { errorKey: `${E}.ineligible` } satisfies Fail
			await addPo({
				invoiceId,
				poNumber,
				poDate,
				poFile: {
					name: file.name,
					bytes: new Uint8Array(await file.arrayBuffer()),
				},
				reprintTotal,
				ivuRate: ratePct / 100,
				userId: user.id,
			})
			// The PO gives the invoice a Claro total, so a waiting JA row may now match.
			// The PO is already saved: a failure here must not turn into a 500.
			try {
				await rematchJaLines()
			} catch (err) {
				// biome-ignore lint/suspicious/noConsole: server-side failure log; the PO is already saved
				console.error("rematchJaLines after addPo failed", err)
			}
		} else if (intent === "mark_sent") {
			const ids = form.getAll("invoiceIds").map(String)
			if (ids.length === 0)
				return { errorKey: `${E}.none_selected` } satisfies Fail
			const sentOn = parseDay(form.get("sentOn"))
			if (!sentOn) return { errorKey: `${E}.bad_input` } satisfies Fail
			if (!(await allEligible(ids)))
				return { errorKey: `${E}.ineligible` } satisfies Fail
			await markAribaSent({ invoiceIds: ids, sentOn, userId: user.id })
		} else {
			throw new Response("Unknown intent", { status: 400 })
		}
		return {} as Partial<Fail>
	} catch (e) {
		if (e instanceof ClaroInstallerError) {
			if (e.code === "po_total_mismatch") {
				const total = e.detail[0]?.replace("expected ", "") ?? ""
				const pct = Number(String(form.get("ivuRate") ?? "").trim() || 4)
				return {
					errorKey: `${E}.po_total_mismatch`,
					expected: Number(total).toLocaleString("en-US", {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
					}),
					rate: String(pct),
				} satisfies Fail
			}
			return {
				errorKey: `${E}.${e.code}`,
				detail: e.detail.join(", "),
			} satisfies Fail
		}
		throw e
	}
}

type Row = Route.ComponentProps["loaderData"]["rows"][number]

function Amounts({ r }: { r: Row }) {
	return (
		<>
			<td className="px-3 py-2 text-right">{formatMoney(r.total)}</td>
			<td className="px-3 py-2 text-right">
				{r.claroTotal == null ? "—" : formatMoney(r.claroTotal)}
			</td>
		</>
	)
}

export default function ClaroInvoices({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const busy = useNavigation().state !== "idle"
	const { rows, today, filter } = loaderData
	const by = (s: ClaroStage) => rows.filter((r) => r.stage === s)
	const err = actionData?.errorKey
		? [
				t(actionData.errorKey as never, {
					expected: actionData.expected ?? "",
					rate: actionData.rate ?? "4",
				}),
				actionData.detail,
			]
				.filter(Boolean)
				.join(" ")
		: null
	const cols = [
		["col_number", ""],
		["col_date", ""],
		["col_amount", " text-right"],
		["col_with_ivu", " text-right"],
	] as const
	const head = cols.map(([k, cls]) => (
		<th key={k} className={`px-3 py-2${cls}`}>
			{t(`installers.claro_invoices.${k}`)}
		</th>
	))
	return (
		<div className="space-y-4 p-6">
			<h1 className="text-2xl font-bold">
				{t("installers.claro_invoices.title")}
			</h1>
			<InstallerStepper current="po" />
			{filter && (
				<Link
					to="/comptroller/installers/claro/invoices"
					className="inline-block rounded-full border px-3 py-1 text-sm"
				>
					{t("installers.claro_invoices.filter_chip", {
						filter: t(`installers.claro_invoices.filter.${filter}`),
					})}
				</Link>
			)}
			{err && (
				<p role="alert" className="text-sm text-status-danger">
					{err}
				</p>
			)}
			{STAGES.map((stage) => {
				const list = by(stage)
				return (
					<section key={stage} className="space-y-2">
						<h2 className="text-lg font-semibold">
							{t(`installers.claro_invoices.stage.${stage}`)} ({list.length})
						</h2>
						{list.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("installers.claro_invoices.none")}
							</p>
						) : stage === "ready_for_ariba" ? (
							<Form method="post">
								<input type="hidden" name="intent" value="mark_sent" />
								<Card>
									<CardContent className="p-0">
										<table className="w-full text-sm">
											<thead>
												<tr className="border-b text-left text-muted-foreground">
													<th className="w-8 px-3 py-2" />
													{head}
												</tr>
											</thead>
											<tbody>
												{list.map((r) => (
													<tr key={r.id} className="border-b last:border-0">
														<td className="px-3 py-2">
															<input
																type="checkbox"
																name="invoiceIds"
																value={r.id}
																aria-label={r.number}
															/>
														</td>
														<td className="px-3 py-2">{r.number}</td>
														<td className="px-3 py-2">
															{formatShortDate(r.date)}
														</td>
														<Amounts r={r} />
													</tr>
												))}
											</tbody>
										</table>
									</CardContent>
								</Card>
								<div className="mt-2 flex items-end gap-3">
									<div>
										<Label htmlFor="sentOn">
											{t("installers.claro_invoices.sent_on")}
										</Label>
										<Input
											id="sentOn"
											name="sentOn"
											type="date"
											defaultValue={today}
											required
										/>
									</div>
									<Button type="submit" disabled={busy}>
										{t("installers.claro_invoices.mark_sent")}
									</Button>
								</div>
							</Form>
						) : (
							<Card>
								<CardContent className="p-0">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b text-left text-muted-foreground">
												{head}
												<th className="px-3 py-2">
													{t("installers.claro_invoices.col_status")}
												</th>
											</tr>
										</thead>
										<tbody>
											{list.map((r) => (
												<tr
													key={r.id}
													className="border-b last:border-0 align-top"
												>
													<td className="px-3 py-2">{r.number}</td>
													<td className="px-3 py-2">
														{formatShortDate(r.date)}
													</td>
													<Amounts r={r} />
													<td className="px-3 py-2">
														{stage === "no_po" && (
															<div className="space-y-2">
																<Badge variant="neutral">
																	{t("installers.claro_invoices.days_waiting", {
																		count: r.daysWaiting,
																	})}
																</Badge>
																<details>
																	<summary className="cursor-pointer text-accent-text">
																		{t("installers.claro_invoices.add_po")}
																	</summary>
																	<Form
																		method="post"
																		encType="multipart/form-data"
																		className="mt-2 grid max-w-sm gap-2"
																	>
																		<input
																			type="hidden"
																			name="intent"
																			value="add_po"
																		/>
																		<input
																			type="hidden"
																			name="invoiceId"
																			value={r.id}
																		/>
																		<Label>
																			{t("installers.claro_invoices.po_number")}
																			<Input name="poNumber" required />
																		</Label>
																		<Label>
																			{t("installers.claro_invoices.po_date")}
																			<Input
																				name="poDate"
																				type="date"
																				defaultValue={today}
																				required
																			/>
																		</Label>
																		<Label>
																			{t(
																				"installers.claro_invoices.reprint_pdf",
																			)}
																			<Input
																				name="poFile"
																				type="file"
																				accept="application/pdf"
																				required
																			/>
																		</Label>
																		<Label>
																			{t(
																				"installers.claro_invoices.reprint_total",
																			)}
																			<Input
																				name="reprintTotal"
																				inputMode="decimal"
																				placeholder={r.expected.toFixed(2)}
																				required
																			/>
																		</Label>
																		<Label>
																			{t("installers.claro_invoices.ivu_rate")}
																			<Input
																				name="ivuRate"
																				inputMode="decimal"
																				placeholder="4"
																			/>
																		</Label>
																		<Button type="submit" disabled={busy}>
																			{t("installers.claro_invoices.save_po")}
																		</Button>
																	</Form>
																</details>
															</div>
														)}
														{stage === "sent" && (
															<Badge variant={r.overdue ? "warn" : "info"}>
																{r.overdue
																	? t("installers.claro_invoices.overdue", {
																			date: formatShortDate(
																				r.aribaSentAt ?? r.date,
																			),
																		})
																	: t(
																			"installers.claro_invoices.sent_on_date",
																			{
																				date: formatShortDate(
																					r.aribaSentAt ?? r.date,
																				),
																			},
																		)}
															</Badge>
														)}
														{stage === "short" && r.shortBy != null && (
															<Badge variant="danger">
																{t("installers.claro_invoices.short_by", {
																	amount: formatMoney(r.shortBy),
																})}
															</Badge>
														)}
														{stage === "paid" && (
															<Badge variant="ok">
																{t("installers.claro_invoices.stage.paid")}
															</Badge>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</CardContent>
							</Card>
						)}
					</section>
				)
			})}
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
