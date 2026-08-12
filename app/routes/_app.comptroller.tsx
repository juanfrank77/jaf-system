import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import {
	FINANCEABLE_STATUSES,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { cn, formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller"

export const meta: Route.MetaFunction = () => [
	{ title: "Comptroller — JAF Ops" },
]

type JobRow = {
	id: string
	controlNumber: string
	jobType: string
	jobAddressEstimated: string
	amount: number
}

type IncomingDocRow = JobRow & {
	sentAt: Date
	pbccRequestPdfPath: string | null
	unread: boolean
	unreadNotificationId: string | null
}

type AwaitingAdvanceRow = JobRow & {
	expectedAdvance: number
	pbccRequestSentAt: Date
}

type AwaitingFinalRow = JobRow & {
	finalClaroUploadedAt: Date
}

type CrewToPayRow = JobRow & {
	advanceAmount: number | null
	assignedCrewIds: string[]
	crewNames: string[]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])

	const [serviceCodes, ivuRate] = await Promise.all([
		db.serviceCode.findMany(),
		getIvuRate(),
	])
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)

	const selectAmountFields = {
		id: true,
		controlNumber: true,
		jobType: true,
		jobAddressEstimated: true,
		materialsUsed: true,
		materialsTaken: true,
	} as const

	const [incomingRaw, awaitingAdvanceRaw, awaitingFinalRaw, crewsToPayRaw] =
		await Promise.all([
			db.jafInvoice.findMany({
				where: { pbccRequestSentAt: { not: null } },
				orderBy: { karmenCopySentAt: "desc" },
				take: 100,
				select: {
					...selectAmountFields,
					karmenCopySentAt: true,
					pbccRequestSentAt: true,
					pbccRequestPdfPath: true,
				},
			}),
			db.jafInvoice.findMany({
				where: {
					status: { in: FINANCEABLE_STATUSES },
					pbccRequestSentAt: { not: null },
					advanceReceivedAt: null,
					receivableClosedAt: null,
				},
				orderBy: { pbccRequestSentAt: "asc" },
				take: 100,
				select: {
					...selectAmountFields,
					pbccRequestSentAt: true,
				},
			}),
			db.jafInvoice.findMany({
				where: {
					status: { in: FINANCEABLE_STATUSES },
					finalClaroUploadedAt: { not: null },
					finalPaymentReceivedAt: null,
					receivableClosedAt: null,
				},
				orderBy: { finalClaroUploadedAt: "asc" },
				take: 100,
				select: {
					...selectAmountFields,
					finalClaroUploadedAt: true,
				},
			}),
			db.jafInvoice.findMany({
				where: {
					status: { in: FINANCEABLE_STATUSES },
					advanceReceivedAt: { not: null },
					paymentRecords: { none: { type: "CREW_PAYMENT" } },
					receivableClosedAt: null,
				},
				orderBy: { advanceReceivedAt: "asc" },
				take: 100,
				select: {
					...selectAmountFields,
					advanceAmount: true,
					assignedCrewIds: true,
				},
			}),
		])

	const incomingIds = incomingRaw.map((d) => d.id)
	const unreadNotifications =
		incomingIds.length > 0
			? await db.notification.findMany({
					where: {
						userId: user.id,
						docId: { in: incomingIds },
						read: false,
					},
					select: { id: true, docId: true },
				})
			: []
	const unreadByDoc = new Map<string, string>()
	for (const n of unreadNotifications) {
		if (n.docId && !unreadByDoc.has(n.docId)) unreadByDoc.set(n.docId, n.id)
	}

	const crewIds = new Set<string>()
	for (const job of crewsToPayRaw) {
		for (const id of job.assignedCrewIds) crewIds.add(id)
	}
	const crewUsers =
		crewIds.size > 0
			? await db.user.findMany({
					where: { id: { in: [...crewIds] } },
					select: { id: true, name: true },
				})
			: []
	const crewNameMap = new Map(crewUsers.map((u) => [u.id, u.name]))

	const toRow = (raw: any): JobRow => ({
		id: raw.id,
		controlNumber: raw.controlNumber,
		jobType: raw.jobType,
		jobAddressEstimated: raw.jobAddressEstimated,
		amount: invoiceTotalUsed(raw, codeMap, ivuRate),
	})

	const incomingDocs: IncomingDocRow[] = incomingRaw.map((d) => ({
		...toRow(d),
		sentAt: d.karmenCopySentAt ?? d.pbccRequestSentAt ?? new Date(),
		pbccRequestPdfPath: d.pbccRequestPdfPath,
		unread: unreadByDoc.has(d.id),
		unreadNotificationId: unreadByDoc.get(d.id) ?? null,
	}))

	const awaitingAdvance: AwaitingAdvanceRow[] = awaitingAdvanceRaw.map((d) => ({
		...toRow(d),
		expectedAdvance: toRow(d).amount * 0.8,
		pbccRequestSentAt: d.pbccRequestSentAt ?? new Date(),
	}))

	const awaitingFinal: AwaitingFinalRow[] = awaitingFinalRaw.map((d) => ({
		...toRow(d),
		finalClaroUploadedAt: d.finalClaroUploadedAt ?? new Date(),
	}))

	const crewsToPay: CrewToPayRow[] = crewsToPayRaw.map((d) => ({
		...toRow(d),
		advanceAmount: d.advanceAmount ? Number(d.advanceAmount) : null,
		assignedCrewIds: d.assignedCrewIds,
		crewNames: d.assignedCrewIds.map(
			(id) => crewNameMap.get(id) ?? id.slice(-6),
		),
	}))

	const unreadCount = incomingDocs.filter((d) => d.unread).length
	const awaitingFundsCount = awaitingAdvance.length + awaitingFinal.length

	return {
		incomingDocs,
		awaitingAdvance,
		awaitingFinal,
		crewsToPay,
		unreadCount,
		awaitingFundsCount,
	}
}

function SectionCard({
	title,
	count,
	children,
}: {
	title: string
	count?: number
	children: React.ReactNode
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				{count !== undefined && (
					<Badge variant={count > 0 ? "warn" : "neutral"}>{count}</Badge>
				)}
			</div>
			{children}
		</div>
	)
}

function Empty({ children }: { children: React.ReactNode }) {
	return (
		<Card>
			<CardContent className="p-4 text-sm text-muted-foreground">
				{children}
			</CardContent>
		</Card>
	)
}

export default function ComptrollerDashboard({
	loaderData,
}: Route.ComponentProps) {
	const {
		incomingDocs,
		awaitingAdvance,
		awaitingFinal,
		crewsToPay,
		unreadCount,
		awaitingFundsCount,
	} = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("comptroller_dashboard.title")}
				</h1>
				<span className="text-xs rounded-md bg-muted px-2 py-0.5 font-semibold">
					{t("comptroller_dashboard.role_label")}
				</span>
			</div>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Card>
					<CardContent className="p-3">
						<p className="text-xs text-muted-foreground">
							{t("comptroller_dashboard.stat.incoming_docs")}
						</p>
						<p className="text-lg font-semibold">{incomingDocs.length}</p>
						{unreadCount > 0 && (
							<p className="text-xs text-amber-700">
								{t("comptroller_dashboard.stat.unread_docs", {
									count: unreadCount,
								})}
							</p>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-3">
						<p className="text-xs text-muted-foreground">
							{t("comptroller_dashboard.stat.awaiting_funds")}
						</p>
						<p className="text-lg font-semibold">{awaitingFundsCount}</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-3">
						<p className="text-xs text-muted-foreground">
							{t("comptroller_dashboard.stat.crews_to_pay")}
						</p>
						<p className="text-lg font-semibold">{crewsToPay.length}</p>
					</CardContent>
				</Card>
			</div>

			<SectionCard
				title={t("comptroller_dashboard.incoming_docs_heading")}
				count={unreadCount > 0 ? unreadCount : undefined}
			>
				{incomingDocs.length === 0 ? (
					<Empty>{t("comptroller_dashboard.no_incoming_docs")}</Empty>
				) : (
					<div className="space-y-2">
						{incomingDocs.map((doc) => (
							<Card
								key={doc.id}
								className={cn(doc.unread && "border-l-4 border-l-amber-500")}
							>
								<CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<Link
												to={`/comptroller/${doc.id}`}
												className="font-mono text-sm font-medium hover:underline"
											>
												{doc.controlNumber}
											</Link>
											{doc.unread && (
												<Badge variant="warn">
													{t("comptroller_dashboard.unread_badge")}
												</Badge>
											)}
										</div>
										<p className="text-sm text-muted-foreground truncate">
											{doc.jobType} — {doc.jobAddressEstimated}
										</p>
										<p className="text-xs text-muted-foreground/70">
											{t("comptroller_dashboard.sent_on", {
												date: new Date(doc.sentAt).toLocaleDateString(),
											})}
										</p>
									</div>
									<div className="flex items-center gap-2">
										{doc.pbccRequestPdfPath && (
											<a
												href={`/files/pbcc-requests/${doc.id}-pbcc-request.pdf`}
												target="_blank"
												rel="noreferrer"
												className={buttonVariants({
													variant: "outline",
													size: "sm",
												})}
											>
												{t("comptroller_dashboard.download_pbcc")}
											</a>
										)}
										{doc.unread && doc.unreadNotificationId && (
											<Form
												method="post"
												action={`/notifications/${doc.unreadNotificationId}/read`}
											>
												<input
													type="hidden"
													name="redirectTo"
													value="/comptroller"
												/>
												<Button type="submit" variant="ghost" size="sm">
													{t("comptroller_dashboard.mark_read")}
												</Button>
											</Form>
										)}
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</SectionCard>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<SectionCard
					title={t("comptroller_dashboard.awaiting_advance_heading")}
					count={
						awaitingAdvance.length > 0 ? awaitingAdvance.length : undefined
					}
				>
					{awaitingAdvance.length === 0 ? (
						<Empty>{t("comptroller_dashboard.no_awaiting_advance")}</Empty>
					) : (
						<div className="space-y-2">
							{awaitingAdvance.map((job) => (
								<Card key={job.id}>
									<CardContent className="p-3">
										<div className="flex items-center justify-between gap-2">
											<Link
												to={`/comptroller/${job.id}`}
												className="font-mono text-sm font-medium hover:underline"
											>
												{job.controlNumber}
											</Link>
											<Badge variant="info">
												{t("comptroller_dashboard.awaiting_funds_badge")}
											</Badge>
										</div>
										<p className="text-sm text-muted-foreground truncate">
											{job.jobType} — {job.jobAddressEstimated}
										</p>
										<p className="text-xs text-muted-foreground/70">
											{t("comptroller_dashboard.expected_advance", {
												amount: formatMoney(job.expectedAdvance),
											})}
										</p>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</SectionCard>

				<SectionCard
					title={t("comptroller_dashboard.awaiting_final_heading")}
					count={awaitingFinal.length > 0 ? awaitingFinal.length : undefined}
				>
					{awaitingFinal.length === 0 ? (
						<Empty>{t("comptroller_dashboard.no_awaiting_final")}</Empty>
					) : (
						<div className="space-y-2">
							{awaitingFinal.map((job) => (
								<Card key={job.id}>
									<CardContent className="p-3">
										<div className="flex items-center justify-between gap-2">
											<Link
												to={`/comptroller/${job.id}`}
												className="font-mono text-sm font-medium hover:underline"
											>
												{job.controlNumber}
											</Link>
											<Badge variant="info">
												{t("comptroller_dashboard.awaiting_final_badge")}
											</Badge>
										</div>
										<p className="text-sm text-muted-foreground truncate">
											{job.jobType} — {job.jobAddressEstimated}
										</p>
										<p className="text-xs text-muted-foreground/70">
											{t("comptroller_dashboard.invoice_amount", {
												amount: formatMoney(job.amount),
											})}
										</p>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</SectionCard>
			</div>

			<SectionCard
				title={t("comptroller_dashboard.crews_to_pay_heading")}
				count={crewsToPay.length > 0 ? crewsToPay.length : undefined}
			>
				{crewsToPay.length === 0 ? (
					<Empty>{t("comptroller_dashboard.no_crews_to_pay")}</Empty>
				) : (
					<div className="space-y-2">
						{crewsToPay.map((job) => (
							<Card key={job.id}>
								<CardContent className="p-3">
									<div className="flex items-center justify-between gap-2">
										<Link
											to={`/comptroller/${job.id}`}
											className="font-mono text-sm font-medium hover:underline"
										>
											{job.controlNumber}
										</Link>
										<Badge variant="warn">
											{t("comptroller_dashboard.crew_unpaid_badge")}
										</Badge>
									</div>
									<p className="text-sm text-muted-foreground truncate">
										{job.jobType} — {job.jobAddressEstimated}
									</p>
									<div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground/70">
										<span>
											{t("comptroller_dashboard.advance_received", {
												amount: formatMoney(job.advanceAmount ?? 0),
											})}
										</span>
										<span>
											{t("comptroller_dashboard.crew_label")}:{" "}
											{job.crewNames.join(", ")}
										</span>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</SectionCard>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
