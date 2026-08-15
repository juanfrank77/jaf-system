import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import {
	FINANCEABLE_STATUSES,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { cn, formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Comptroller — JAF Ops`
			: "JAF Ops",
	},
]

function parseLocalDate(value: string): Date | null {
	if (!value) return null
	const [year, month, day] = value.split("-").map(Number)
	if (
		Number.isNaN(year) ||
		Number.isNaN(month) ||
		Number.isNaN(day) ||
		month < 1 ||
		month > 12
	) {
		return null
	}
	return new Date(year, month - 1, day)
}

type AssignmentHistoryEntry = {
	userIds: string[]
	assignedById?: string | null
	assignedAt?: string
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: { select: { name: true } },
			paymentRecords: {
				orderBy: { date: "asc" },
				include: { recordedBy: { select: { name: true } } },
			},
			poLinks: { orderBy: { id: "asc" } },
		},
	})

	if (!FINANCEABLE_STATUSES.includes(doc.status)) {
		throw new Response("Job is not in the receivables pipeline", {
			status: 404,
		})
	}

	const [serviceCodes, ivuRate] = await Promise.all([
		db.serviceCode.findMany(),
		getIvuRate(),
	])
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	const expectedAdvance = amount * 0.8

	const crewIds = new Set<string>(doc.assignedCrewIds)
	const history =
		(doc.crewAssignmentHistory as AssignmentHistoryEntry[] | null) ?? []
	for (const entry of history) {
		for (const id of entry.userIds) crewIds.add(id)
	}
	const crewUsers =
		crewIds.size > 0
			? await db.user.findMany({
					where: { id: { in: [...crewIds] } },
					select: { id: true, name: true },
				})
			: []
	const crewNameMap = new Map(crewUsers.map((u) => [u.id, u.name]))

	const currentCrewNames = doc.assignedCrewIds.map(
		(id) => crewNameMap.get(id) ?? id.slice(-6),
	)
	const historyWithNames = history.map((entry) => ({
		...entry,
		crewNames: entry.userIds.map((id) => crewNameMap.get(id) ?? id.slice(-6)),
		assignedByName: entry.assignedById
			? (crewNameMap.get(entry.assignedById) ?? entry.assignedById.slice(-6))
			: null,
		assignedAt: entry.assignedAt ? new Date(entry.assignedAt) : null,
	}))

	const advanceReceived = !!doc.advanceReceivedAt
	const finalReceived = !!doc.finalPaymentReceivedAt
	const crewPaid = doc.paymentRecords.some((p) => p.type === "CREW_PAYMENT")

	const unreadNotification = await db.notification.findFirst({
		where: { userId: user.id, docId: doc.id, read: false },
		select: { id: true },
		orderBy: { createdAt: "desc" },
	})

	return {
		doc,
		amount,
		expectedAdvance,
		advanceReceived,
		finalReceived,
		crewPaid,
		currentCrewNames,
		historyWithNames,
		unreadNotificationId: unreadNotification?.id ?? null,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	const docId = params.id

	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: docId },
		include: { supervisor: { select: { name: true } } },
	})

	const financeUsers = await db.user.findMany({
		where: { role: "FINANCE", active: true },
		select: { id: true },
	})

	const rawAmount = form.get("amount") as string
	const parsedAmount = Number.parseFloat(rawAmount)
	if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
		return { errorKey: "comptroller_detail.errors.invalid_amount" }
	}

	const rawDate = form.get("date") as string
	const parsedDate = parseLocalDate(rawDate)
	if (!parsedDate) {
		return { errorKey: "comptroller_detail.errors.invalid_date" }
	}

	if (intent === "record_advance") {
		if (doc.advanceReceivedAt) {
			return { errorKey: "comptroller_detail.errors.advance_already_recorded" }
		}

		const [serviceCodes, ivuRate] = await Promise.all([
			db.serviceCode.findMany(),
			getIvuRate(),
		])
		const codeMap = Object.fromEntries(
			serviceCodes.map((c) => [
				c.id,
				{ unitPrice: toNumberPrice(c.unitPrice) },
			]),
		)
		const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
		const expectedAdvance = amount * 0.8

		await db.$transaction([
			db.jafInvoice.update({
				where: { id: docId },
				data: {
					advanceReceivedAt: parsedDate,
					advanceAmount: parsedAmount,
				},
			}),
			db.paymentRecord.create({
				data: {
					jobId: docId,
					type: "PBCC_ADVANCE",
					amount: parsedAmount,
					date: parsedDate,
					recordedById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "ADVANCE_RECEIVED",
					diffJson: {
						amount: parsedAmount,
						expected: expectedAdvance,
						discrepancy: Math.abs(parsedAmount - expectedAdvance) > 0.01,
					},
				},
			}),
			...financeUsers.map((u) =>
				db.notification.create({
					data: {
						userId: u.id,
						docId,
						message:
							Math.abs(parsedAmount - expectedAdvance) > 0.01
								? `PBCC advance for ${doc.controlNumber} was ${formatMoney(parsedAmount)} (expected ${formatMoney(expectedAdvance)}).`
								: `PBCC advance of ${formatMoney(parsedAmount)} recorded for ${doc.controlNumber}.`,
					},
				}),
			),
		])
		return { successKey: "comptroller_detail.success.advance_recorded" }
	}

	if (intent === "record_final") {
		if (doc.finalPaymentReceivedAt) {
			return { errorKey: "comptroller_detail.errors.final_already_recorded" }
		}

		const message = `Claro final payment of ${formatMoney(
			parsedAmount,
		)} recorded for ${doc.controlNumber}. Close entry is now unlocked.`

		await db.$transaction([
			db.jafInvoice.update({
				where: { id: docId },
				data: {
					finalPaymentReceivedAt: parsedDate,
					finalPaymentAmount: parsedAmount,
				},
			}),
			db.paymentRecord.create({
				data: {
					jobId: docId,
					type: "CLARO_FINAL",
					amount: parsedAmount,
					date: parsedDate,
					recordedById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "FINAL_PAYMENT_RECEIVED",
					diffJson: { amount: parsedAmount },
				},
			}),
			...financeUsers.map((u) =>
				db.notification.create({
					data: {
						userId: u.id,
						docId,
						message,
					},
				}),
			),
		])
		return { successKey: "comptroller_detail.success.final_recorded" }
	}

	if (intent === "record_crew_payment") {
		const note = (form.get("note") as string | null)?.trim() || null

		const [serviceCodes, ivuRate] = await Promise.all([
			db.serviceCode.findMany(),
			getIvuRate(),
		])
		const codeMap = Object.fromEntries(
			serviceCodes.map((c) => [
				c.id,
				{ unitPrice: toNumberPrice(c.unitPrice) },
			]),
		)
		const amount = invoiceTotalUsed(doc, codeMap, ivuRate)

		if (parsedAmount > amount) {
			return {
				errorKey: "comptroller_detail.errors.amount_exceeds_invoice_total",
			}
		}

		const existingCrewPayment = await db.paymentRecord.findFirst({
			where: { jobId: docId, type: "CREW_PAYMENT" },
		})
		if (existingCrewPayment) {
			return {
				errorKey: "comptroller_detail.errors.crew_payment_already_recorded",
			}
		}

		await db.$transaction([
			db.paymentRecord.create({
				data: {
					jobId: docId,
					type: "CREW_PAYMENT",
					amount: parsedAmount,
					date: parsedDate,
					recordedById: user.id,
					note,
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "CREW_PAYMENT_RECORDED",
					diffJson: { amount: parsedAmount, note },
				},
			}),
		])
		return { successKey: "comptroller_detail.success.crew_payment_recorded" }
	}

	return { errorKey: "comptroller_detail.errors.unknown_intent" }
}

export default function ComptrollerDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		amount,
		expectedAdvance,
		advanceReceived,
		finalReceived,
		crewPaid,
		currentCrewNames,
		historyWithNames,
		unreadNotificationId,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | null
	const success = actionData as { successKey?: string } | null

	const today = new Date().toISOString().slice(0, 10)

	const pbccUrl = doc.pbccRequestPdfPath
		? `/files/pbcc-requests/${doc.id}-pbcc-request.pdf`
		: null

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-xl font-semibold">
							{t("comptroller_detail.title")}
						</h1>
						{unreadNotificationId && (
							<Badge variant="warn">
								{t("comptroller_detail.unread_badge")}
							</Badge>
						)}
					</div>
					<p className="font-mono text-sm text-slate-500">
						{doc.controlNumber}
					</p>
				</div>
				<Link
					to="/comptroller"
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					{t("comptroller_detail.back")}
				</Link>
			</div>

			{error?.errorKey && (
				<p className="text-sm text-red-600">{t(error.errorKey as any)}</p>
			)}
			{success?.successKey && (
				<p className="text-sm text-green-700">{t(success.successKey as any)}</p>
			)}

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Card>
					<CardContent className="space-y-2 p-4 text-sm">
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.job_type")}:
							</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.address")}:
							</span>{" "}
							{doc.jobAddressActual || doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.supervisor")}:
							</span>{" "}
							{doc.supervisor?.name ?? "—"}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.current_crew")}:
							</span>{" "}
							{currentCrewNames.join(", ")}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="space-y-2 p-4 text-sm">
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.invoice_amount")}:
							</span>{" "}
							<span className="font-medium">{formatMoney(amount)}</span>
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.expected_advance")}:
							</span>{" "}
							{formatMoney(expectedAdvance)}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.advance_status")}:
							</span>{" "}
							{advanceReceived
								? t("comptroller_detail.status_recorded")
								: t("comptroller_detail.status_pending")}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.final_status")}:
							</span>{" "}
							{finalReceived
								? t("comptroller_detail.status_recorded")
								: t("comptroller_detail.status_pending")}
						</p>
						<p>
							<span className="text-slate-500">
								{t("comptroller_detail.crew_payment_status")}:
							</span>{" "}
							{crewPaid
								? t("comptroller_detail.status_recorded")
								: t("comptroller_detail.status_pending")}
						</p>
					</CardContent>
				</Card>
			</div>

			{pbccUrl && (
				<Card>
					<CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
						<div>
							<h2 className="text-sm font-semibold">
								{t("comptroller_detail.incoming_doc_heading")}
							</h2>
							<p className="text-xs text-muted-foreground">
								{t("comptroller_detail.sent_on", {
									date: new Date(
										doc.karmenCopySentAt ?? doc.pbccRequestSentAt ?? new Date(),
									).toLocaleDateString(),
								})}
							</p>
						</div>
						<a
							href={pbccUrl}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("comptroller_detail.download_pbcc")}
						</a>
					</CardContent>
				</Card>
			)}

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<Card className={cn(advanceReceived && "opacity-75")}>
					<CardContent className="space-y-3 p-4">
						<h2 className="text-sm font-semibold">
							{t("comptroller_detail.record_advance_heading")}
						</h2>
						{advanceReceived ? (
							<p className="text-sm text-muted-foreground">
								{t("comptroller_detail.advance_recorded", {
									amount: formatMoney(doc.advanceAmount ?? 0),
									date: new Date(doc.advanceReceivedAt!).toLocaleDateString(),
								})}
							</p>
						) : (
							<Form method="post" className="space-y-3">
								<input type="hidden" name="intent" value="record_advance" />
								<div className="space-y-1">
									<Label htmlFor="advance-date">
										{t("comptroller_detail.date_label")}
									</Label>
									<Input
										id="advance-date"
										name="date"
										type="date"
										defaultValue={today}
										required
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="advance-amount">
										{t("comptroller_detail.amount_label")}
									</Label>
									<Input
										id="advance-amount"
										name="amount"
										type="number"
										step="0.01"
										defaultValue={expectedAdvance.toFixed(2)}
										required
									/>
								</div>
								<Button type="submit" size="sm">
									{t("comptroller_detail.record_advance_submit")}
								</Button>
							</Form>
						)}
					</CardContent>
				</Card>

				<Card className={cn(crewPaid && "opacity-75")}>
					<CardContent className="space-y-3 p-4">
						<h2 className="text-sm font-semibold">
							{t("comptroller_detail.record_crew_payment_heading")}
						</h2>
						{crewPaid ? (
							<p className="text-sm text-muted-foreground">
								{t("comptroller_detail.crew_payment_recorded")}
							</p>
						) : (
							<Form method="post" className="space-y-3">
								<input
									type="hidden"
									name="intent"
									value="record_crew_payment"
								/>
								<div className="space-y-1">
									<Label htmlFor="crew-date">
										{t("comptroller_detail.date_label")}
									</Label>
									<Input
										id="crew-date"
										name="date"
										type="date"
										defaultValue={today}
										required
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="crew-amount">
										{t("comptroller_detail.amount_label")}
									</Label>
									<Input
										id="crew-amount"
										name="amount"
										type="number"
										step="0.01"
										placeholder={t(
											"comptroller_detail.crew_amount_placeholder",
										)}
										required
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="crew-note">
										{t("comptroller_detail.note_label")}
									</Label>
									<Textarea
										id="crew-note"
										name="note"
										rows={2}
										placeholder={t("comptroller_detail.note_placeholder")}
									/>
								</div>
								<Button type="submit" size="sm">
									{t("comptroller_detail.record_crew_payment_submit")}
								</Button>
							</Form>
						)}
					</CardContent>
				</Card>

				<Card className={cn(finalReceived && "opacity-75")}>
					<CardContent className="space-y-3 p-4">
						<h2 className="text-sm font-semibold">
							{t("comptroller_detail.record_final_heading")}
						</h2>
						{finalReceived ? (
							<p className="text-sm text-muted-foreground">
								{t("comptroller_detail.final_recorded", {
									amount: formatMoney(doc.finalPaymentAmount ?? 0),
									date: new Date(
										doc.finalPaymentReceivedAt!,
									).toLocaleDateString(),
								})}
							</p>
						) : (
							<Form method="post" className="space-y-3">
								<input type="hidden" name="intent" value="record_final" />
								<div className="space-y-1">
									<Label htmlFor="final-date">
										{t("comptroller_detail.date_label")}
									</Label>
									<Input
										id="final-date"
										name="date"
										type="date"
										defaultValue={today}
										required
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="final-amount">
										{t("comptroller_detail.amount_label")}
									</Label>
									<Input
										id="final-amount"
										name="amount"
										type="number"
										step="0.01"
										placeholder={t(
											"comptroller_detail.final_amount_placeholder",
										)}
										required
									/>
								</div>
								<Button type="submit" size="sm">
									{t("comptroller_detail.record_final_submit")}
								</Button>
							</Form>
						)}
					</CardContent>
				</Card>
			</div>

			{historyWithNames.length > 0 && (
				<Card>
					<CardContent className="space-y-2 p-4">
						<h2 className="text-sm font-semibold">
							{t("comptroller_detail.crew_history_heading")}
						</h2>
						<ul className="space-y-2 text-sm">
							{historyWithNames.map((entry, idx) => (
								<li
									key={`${entry.assignedAt?.toISOString() ?? idx}`}
									className="rounded-md border p-2"
								>
									<p className="font-medium">{entry.crewNames.join(", ")}</p>
									<p className="text-xs text-muted-foreground">
										{t("comptroller_detail.crew_history_assigned", {
											date: entry.assignedAt
												? entry.assignedAt.toLocaleDateString()
												: "—",
											by: entry.assignedByName ?? "—",
										})}
									</p>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="space-y-3 p-4">
					<h2 className="text-sm font-semibold">
						{t("comptroller_detail.payment_records_heading")}
					</h2>
					{doc.paymentRecords.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("comptroller_detail.no_payment_records")}
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-slate-500 border-b">
										<th className="pb-1">
											{t("comptroller_detail.table.date")}
										</th>
										<th className="pb-1">
											{t("comptroller_detail.table.type")}
										</th>
										<th className="pb-1 text-right">
											{t("comptroller_detail.table.amount")}
										</th>
										<th className="pb-1">
											{t("comptroller_detail.table.recorded_by")}
										</th>
										<th className="pb-1">
											{t("comptroller_detail.table.note")}
										</th>
									</tr>
								</thead>
								<tbody>
									{doc.paymentRecords.map((pr) => (
										<tr key={pr.id} className="border-b last:border-0">
											<td className="py-1">
												{new Date(pr.date).toLocaleDateString()}
											</td>
											<td>{pr.type}</td>
											<td className="text-right">
												{formatMoney(toNumberPrice(pr.amount))}
											</td>
											<td>{pr.recordedBy?.name ?? "—"}</td>
											<td>{pr.note ?? "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
