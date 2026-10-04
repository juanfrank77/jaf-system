import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { data, Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import { isComptrollerEnabled } from "~/lib/features.server"
import {
	computeFinanceStage,
	FINANCEABLE_STATUSES,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { parsePaymentDate, paymentForType } from "~/lib/payment-records"
import { recordReceivablePayment } from "~/lib/payment-records.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate, getLcPbccAdvanceRate } from "~/lib/system-settings.server"
import { cn, formatMoney, toNumberPrice } from "~/lib/utils"

// Route types are local: this screen is env-gated off, so react-router
// typegen does not emit ./+types/_app.comptroller.$id.
type ComptrollerLoaderArgs = { request: Request; params: { id: string } }

export const meta = ({
	data,
}: {
	data?: { doc: { controlNumber: string } } | undefined
}) => [
	{
		title: data
			? `${data.doc.controlNumber} — Comptroller — JAF Ops`
			: "JAF Ops",
	},
]

// Two shapes can appear in `crewAssignmentHistory`:
// - the legacy individual-crew reassign shape (`{ userIds, assignedById, assignedAt }`)
// - the brigade reassign shape written by `reassignToBrigade` in
//   `_app.docs.$id.tsx` (`{ brigadeId, by, at }`)
type IndividualAssignmentHistoryEntry = {
	userIds: string[]
	assignedById?: string | null
	assignedAt?: string
}
type BrigadeAssignmentHistoryEntry = {
	brigadeId: string
	by: string
	at: string
}
type AssignmentHistoryEntry =
	| IndividualAssignmentHistoryEntry
	| BrigadeAssignmentHistoryEntry

function hasUserIds(
	entry: AssignmentHistoryEntry,
): entry is IndividualAssignmentHistoryEntry {
	return Array.isArray((entry as IndividualAssignmentHistoryEntry).userIds)
}

export async function loader({ request, params }: ComptrollerLoaderArgs) {
	if (!isComptrollerEnabled()) throw data(null, { status: 404 })
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

	if (
		!FINANCEABLE_STATUSES.includes(doc.status) ||
		doc.status === "LC_REQUEST_GENERATED"
	) {
		throw new Response("Job is not in the receivables pipeline", {
			status: 404,
		})
	}

	const [serviceCodes, ivuRate, lcPbccAdvanceRate] = await Promise.all([
		db.serviceCode.findMany(),
		getIvuRate(),
		getLcPbccAdvanceRate(),
	])
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	const expectedAdvance = amount * lcPbccAdvanceRate

	const crewIds = new Set<string>(doc.assignedCrewIds)
	const history =
		(doc.crewAssignmentHistory as AssignmentHistoryEntry[] | null) ?? []
	for (const entry of history) {
		if (hasUserIds(entry)) {
			for (const id of entry.userIds) crewIds.add(id)
			if (entry.assignedById) crewIds.add(entry.assignedById)
		} else {
			crewIds.add(entry.by)
		}
	}
	const crewUsers =
		crewIds.size > 0
			? await db.user.findMany({
					where: { id: { in: [...crewIds] } },
					select: { id: true, name: true },
				})
			: []
	const crewNameMap = new Map(crewUsers.map((u) => [u.id, u.name]))

	const brigadeIds = [
		...new Set(
			history.flatMap((entry) => (hasUserIds(entry) ? [] : [entry.brigadeId])),
		),
	]
	const brigades =
		brigadeIds.length > 0
			? await db.brigade.findMany({
					where: { id: { in: brigadeIds } },
					select: { id: true, name: true },
				})
			: []
	const brigadeNameMap = new Map(brigades.map((b) => [b.id, b.name]))

	const currentCrewNames = doc.assignedCrewIds.map(
		(id) => crewNameMap.get(id) ?? id.slice(-6),
	)
	const historyWithNames = history.map((entry) => {
		if (hasUserIds(entry)) {
			return {
				...entry,
				crewNames: entry.userIds.map(
					(id) => crewNameMap.get(id) ?? id.slice(-6),
				),
				assignedByName: entry.assignedById
					? (crewNameMap.get(entry.assignedById) ??
						entry.assignedById.slice(-6))
					: null,
				assignedAt: entry.assignedAt ? new Date(entry.assignedAt) : null,
			}
		}
		return {
			...entry,
			crewNames: [
				brigadeNameMap.get(entry.brigadeId) ?? entry.brigadeId.slice(-6),
			],
			assignedByName: crewNameMap.get(entry.by) ?? entry.by.slice(-6),
			assignedAt: entry.at ? new Date(entry.at) : null,
		}
	})

	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	const advancePayment = paymentForType(doc.paymentRecords, "PBCC_ADVANCE")
	const finalPayment = paymentForType(doc.paymentRecords, "CLARO_FINAL")
	const advanceReceived = !!advancePayment
	const finalReceived = !!finalPayment
	const crewPaid = doc.paymentRecords.some((p) => p.type === "CREW_PAYMENT")
	const hasAdvanceDiscrepancy =
		advanceReceived && advancePayment?.amount != null
			? Math.abs(Number(advancePayment?.amount) - expectedAdvance) > 0.01
			: false

	const unreadNotification = await db.notification.findFirst({
		where: { userId: user.id, docId: doc.id, read: false },
		select: { id: true },
		orderBy: { createdAt: "desc" },
	})

	return {
		doc,
		amount,
		expectedAdvance,
		lcPbccAdvanceRate,
		stage,
		advanceReceived,
		finalReceived,
		crewPaid,
		hasAdvanceDiscrepancy,
		currentCrewNames,
		historyWithNames,
		unreadNotificationId: unreadNotification?.id ?? null,
	}
}

export async function action({ request, params }: ComptrollerLoaderArgs) {
	if (!isComptrollerEnabled()) throw data(null, { status: 404 })
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	if (
		!["record_advance", "record_final", "record_crew_payment"].includes(intent)
	) {
		return { errorKey: "comptroller_detail.errors.unknown_intent" }
	}

	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: { select: { name: true } },
			paymentRecords: { select: { type: true, amount: true, date: true } },
			poLinks: true,
		},
	})
	if (
		!FINANCEABLE_STATUSES.includes(doc.status) ||
		doc.status === "LC_REQUEST_GENERATED"
	) {
		return { errorKey: "comptroller_detail.errors.invalid_stage" }
	}
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	const advancePayment = paymentForType(doc.paymentRecords, "PBCC_ADVANCE")
	const financeUsers = await db.user.findMany({
		where: { role: "FINANCE", active: true },
		select: { id: true, email: true },
	})

	if (intent === "record_advance" || intent === "record_final") {
		const expectedStage =
			intent === "record_advance" ? "WAITING_PBCC_FUNDING" : "IN_CLARO_QUEUE"
		if (stage !== expectedStage)
			return { errorKey: "comptroller_detail.errors.invalid_stage" }
		const parsedAmount = Number.parseFloat(String(form.get("amount") ?? ""))
		const parsedDate = parsePaymentDate(String(form.get("date") ?? ""))
		if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
			return { errorKey: "comptroller_detail.errors.invalid_amount" }
		if (!parsedDate)
			return { errorKey: "comptroller_detail.errors.invalid_date" }
		const note = (form.get("paymentNote") as string | null)?.trim() || null
		let auditDiff: Record<string, unknown> | undefined
		let message: string
		if (intent === "record_advance") {
			const [serviceCodes, ivuRate, lcPbccAdvanceRate] = await Promise.all([
				db.serviceCode.findMany(),
				getIvuRate(),
				getLcPbccAdvanceRate(),
			])
			const codeMap = Object.fromEntries(
				serviceCodes.map((c) => [
					c.id,
					{ unitPrice: toNumberPrice(c.unitPrice) },
				]),
			)
			const expectedAdvance =
				invoiceTotalUsed(doc, codeMap, ivuRate) * lcPbccAdvanceRate
			const discrepancy = Math.abs(parsedAmount - expectedAdvance) > 0.01
			auditDiff = { expected: expectedAdvance, discrepancy }
			message = discrepancy
				? "PBCC advance for " +
					doc.controlNumber +
					" was " +
					formatMoney(parsedAmount) +
					" (expected " +
					formatMoney(expectedAdvance) +
					")."
				: "PBCC advance of " +
					formatMoney(parsedAmount) +
					" recorded for " +
					doc.controlNumber +
					"."
		} else {
			message =
				"Claro final payment of " +
				formatMoney(parsedAmount) +
				" recorded for " +
				doc.controlNumber +
				"."
		}
		const result = await recordReceivablePayment({
			jobId: doc.id,
			type: intent === "record_advance" ? "PBCC_ADVANCE" : "CLARO_FINAL",
			amount: parsedAmount,
			date: parsedDate,
			note,
			actorId: user.id,
			auditDiff,
		})
		if (result.duplicate) {
			return {
				errorKey:
					intent === "record_advance"
						? "comptroller_detail.errors.advance_already_recorded"
						: "comptroller_detail.errors.final_already_recorded",
			}
		}
		await db.notification.createMany({
			data: financeUsers.map((recipient) => ({
				userId: recipient.id,
				docId: doc.id,
				message,
			})),
		})
		await sendInternalEmail({
			docId: doc.id,
			actorId: user.id,
			recipients: financeUsers.map((recipient) => recipient.email),
			subject: message,
			context:
				intent === "record_advance"
					? "PBCC_ADVANCE_RECEIVED"
					: "CLARO_FINAL_RECEIVED",
		})
		return {
			successKey:
				intent === "record_advance"
					? "comptroller_detail.success.advance_recorded"
					: "comptroller_detail.success.final_recorded",
		}
	}

	if (
		!advancePayment ||
		![
			"WAITING_CLARO_PO",
			"PO_RECEIVED_UPLOAD",
			"IN_CLARO_QUEUE",
			"READY_TO_CLOSE",
		].includes(stage ?? "")
	) {
		return { errorKey: "comptroller_detail.errors.invalid_stage" }
	}
	const parsedAmount = Number.parseFloat(String(form.get("amount") ?? ""))
	const parsedDate = parsePaymentDate(String(form.get("date") ?? ""))
	if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
		return { errorKey: "comptroller_detail.errors.invalid_amount" }
	if (!parsedDate) return { errorKey: "comptroller_detail.errors.invalid_date" }
	const note = (form.get("note") as string | null)?.trim() || null
	const [serviceCodes, ivuRate] = await Promise.all([
		db.serviceCode.findMany(),
		getIvuRate(),
	])
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)
	if (parsedAmount > amount)
		return {
			errorKey: "comptroller_detail.errors.amount_exceeds_invoice_total",
		}
	const existingCrewPayment = await db.paymentRecord.findFirst({
		where: { jobId: doc.id, type: "CREW_PAYMENT" },
	})
	if (existingCrewPayment)
		return {
			errorKey: "comptroller_detail.errors.crew_payment_already_recorded",
		}
	await db.$transaction([
		db.paymentRecord.create({
			data: {
				jobId: doc.id,
				type: "CREW_PAYMENT",
				amount: parsedAmount,
				date: parsedDate,
				recordedById: user.id,
				note,
			},
		}),
		db.auditTrail.create({
			data: {
				docId: doc.id,
				userId: user.id,
				action: "CREW_PAYMENT_RECORDED",
				diffJson: { amount: parsedAmount, note },
			},
		}),
	])
	return { successKey: "comptroller_detail.success.crew_payment_recorded" }
}

export default function ComptrollerDetail({
	loaderData,
	actionData,
}: {
	loaderData: Awaited<ReturnType<typeof loader>>
	actionData: unknown
}) {
	const {
		doc,
		amount,
		expectedAdvance,
		lcPbccAdvanceRate,
		stage,
		advanceReceived,
		finalReceived,
		crewPaid,
		hasAdvanceDiscrepancy,
		currentCrewNames,
		historyWithNames,
		unreadNotificationId,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | null
	const success = actionData as { successKey?: string } | null

	const today = new Date().toISOString().slice(0, 10)
	const advancePayment = paymentForType(doc.paymentRecords, "PBCC_ADVANCE")
	const finalPayment = paymentForType(doc.paymentRecords, "CLARO_FINAL")

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
					<p className="font-mono text-sm text-muted-foreground">
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
				<p className="text-sm text-status-danger">
					{t(error.errorKey as ParseKeys)}
				</p>
			)}
			{success?.successKey && (
				<p className="text-sm text-status-ok">
					{t(success.successKey as ParseKeys)}
				</p>
			)}

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Card>
					<CardContent className="space-y-2 p-4 text-sm">
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.job_type")}:
							</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.address")}:
							</span>{" "}
							{doc.jobAddressActual || doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.supervisor")}:
							</span>{" "}
							{doc.supervisor?.name ?? "—"}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.current_crew")}:
							</span>{" "}
							{currentCrewNames.join(", ")}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="space-y-2 p-4 text-sm">
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.invoice_amount")}:
							</span>{" "}
							<span className="font-medium">{formatMoney(amount)}</span>
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.expected_advance", {
									rate: (lcPbccAdvanceRate * 100).toFixed(1),
								})}
								:
							</span>{" "}
							{formatMoney(expectedAdvance)}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.advance_status")}:
							</span>{" "}
							{advanceReceived
								? t("comptroller_detail.status_recorded")
								: t("comptroller_detail.status_pending")}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("comptroller_detail.final_status")}:
							</span>{" "}
							{finalReceived
								? t("comptroller_detail.status_recorded")
								: t("comptroller_detail.status_pending")}
						</p>
						<p>
							<span className="text-muted-foreground">
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
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-sm font-semibold">
								{t("comptroller_detail.record_advance_heading")}
							</h2>
							{hasAdvanceDiscrepancy && (
								<Badge variant="warn">
									{t("comptroller_detail.discrepancy_badge")}
								</Badge>
							)}
						</div>
						{advanceReceived ? (
							<div className="space-y-1 text-sm">
								<p className="text-muted-foreground">
									{t("comptroller_detail.advance_recorded", {
										amount: formatMoney(Number(advancePayment?.amount ?? 0)),
										date: new Date(
											advancePayment?.date ?? new Date(),
										).toLocaleDateString(),
									})}
								</p>
								{hasAdvanceDiscrepancy && (
									<p className="text-xs text-status-danger">
										{t("comptroller_detail.discrepancy_notice", {
											expected: formatMoney(expectedAdvance),
										})}
									</p>
								)}
							</div>
						) : stage === "WAITING_PBCC_FUNDING" ? (
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
								<div className="space-y-1">
									<Label htmlFor="advance-note">
										{t("comptroller_detail.payment_note_label")}
									</Label>
									<Input id="advance-note" name="paymentNote" />
								</div>
								\n
								<Button type="submit" size="sm">
									\n {t("comptroller_detail.record_advance_submit")}
								</Button>
							</Form>
						) : null}
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
									amount: formatMoney(Number(finalPayment?.amount ?? 0)),
									date: new Date(
										finalPayment?.date ?? new Date(),
									).toLocaleDateString(),
								})}
							</p>
						) : stage === "IN_CLARO_QUEUE" ? (
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
								<div className="space-y-1">
									<Label htmlFor="final-note">
										{t("comptroller_detail.payment_note_label")}
									</Label>
									<Input id="final-note" name="paymentNote" />
								</div>
								\n
								<Button type="submit" size="sm">
									\n {t("comptroller_detail.record_final_submit")}
								</Button>
							</Form>
						) : null}
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
									<tr className="text-left text-muted-foreground border-b">
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

export function ErrorBoundary({ error }: { error: unknown }) {
	return <RouteErrorBoundary error={error} />
}
