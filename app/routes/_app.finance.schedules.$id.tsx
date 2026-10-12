import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import {
	discardBankSchedule,
	markScheduleSent,
	ScheduleValidationError,
} from "~/lib/bank-schedule.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.schedules.$id"

export const meta: Route.MetaFunction = () => [
	{ title: "Bank schedule — JAF Ops" },
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const s = await db.bankSchedule.findUnique({
		where: { id: params.id },
		include: {
			invoices: {
				orderBy: { controlNumber: "asc" },
				select: {
					id: true,
					controlNumber: true,
					avisoNumber: true,
					jafInvoiceLineTotal: true,
					bankInvoicePdfPath: true,
					brigade: { select: { area: true } },
				},
			},
		},
	})
	if (!s) throw new Response("Not found", { status: 404 })
	return {
		user,
		schedule: {
			id: s.id,
			number: s.number,
			generatedAt: s.generatedAt.toISOString(),
			sentAt: s.sentAt?.toISOString() ?? null,
			advanceRate: Number(s.advanceRate),
			total: toNumberPrice(s.total),
			advanceAmount: toNumberPrice(s.advanceAmount),
			hasXlsx: Boolean(s.xlsxPath),
			invoices: s.invoices.map((i) => ({
				id: i.id,
				controlNumber: i.controlNumber,
				avisoNumber: i.avisoNumber,
				amount: toNumberPrice(i.jafInvoiceLineTotal),
				area: i.brigade?.area ?? null,
				hasInvoicePdf: Boolean(i.bankInvoicePdfPath),
			})),
		},
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "mark_sent") {
			await markScheduleSent({ scheduleId: params.id, sentById: user.id })
			return { ok: true as const }
		}
		if (intent === "discard") {
			const { discarded } = await discardBankSchedule({ scheduleId: params.id })
			if (discarded) return redirect("/finance/lc-requests")
			return {
				ok: false as const,
				errorKey: "finance_schedule.errors.already_sent" as const,
				list: "",
			}
		}
	} catch (e) {
		if (e instanceof ScheduleValidationError) {
			if (e.code === "not_found")
				throw new Response("Not found", { status: 404 })
			if (e.code === "incomplete" || e.code === "not_eligible")
				return {
					ok: false as const,
					errorKey:
						e.code === "incomplete"
							? ("finance_schedule.errors.incomplete" as const)
							: ("finance_schedule.errors.not_eligible" as const),
					list: e.controlNumbers.join(", "),
				}
		}
		throw e
	}
	return { ok: false as const, errorKey: undefined, list: "" }
}

export default function BankSchedulePage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { schedule } = loaderData
	const { t } = useTranslation()
	const navigation = useNavigation()
	const submitting = navigation.state === "submitting"
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_schedule.title", { number: schedule.number })}
				</h1>
				<StageChip arm="A" step={2} total={5} />
			</div>
			<FinanceStepRail current="LC_REQUEST" />
			<div className="bg-card border rounded-lg p-4 space-y-1 text-sm">
				<p>
					{t("finance_schedule.total")}:{" "}
					<strong>{formatMoney(schedule.total)}</strong>
				</p>
				<p>
					{t("finance_schedule.advance", {
						rate: Math.round(schedule.advanceRate * 100),
					})}
					: <strong>{formatMoney(schedule.advanceAmount)}</strong>
				</p>
				{schedule.sentAt ? (
					<Badge variant="ok">
						{t("finance_schedule.sent_on", {
							date: new Date(schedule.sentAt).toLocaleDateString(undefined, {
								timeZone: "America/Puerto_Rico",
							}),
						})}
					</Badge>
				) : (
					<Badge variant="warn">{t("finance_schedule.not_sent")}</Badge>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{schedule.hasXlsx && (
					<a
						href={`/finance/schedules/${schedule.id}/xlsx`}
						download
						className={buttonVariants({ variant: "secondary" })}
					>
						{t("finance_schedule.download_xlsx")}
					</a>
				)}
				{!schedule.sentAt && schedule.hasXlsx && (
					<Form method="post">
						<input type="hidden" name="intent" value="mark_sent" />
						<Button type="submit" disabled={submitting}>
							{t("finance_schedule.mark_sent")}
						</Button>
					</Form>
				)}
				{!schedule.sentAt && (
					<Form
						method="post"
						onSubmit={(e) => {
							if (!window.confirm(t("finance_schedule.discard_confirm")))
								e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="discard" />
						<Button type="submit" variant="outline" disabled={submitting}>
							{t("finance_schedule.discard")}
						</Button>
					</Form>
				)}
			</div>
			{!schedule.sentAt && !schedule.hasXlsx && (
				<p className="text-sm text-amber-700">
					{t("finance_schedule.incomplete_notice")}
				</p>
			)}
			{actionData && "errorKey" in actionData && actionData.errorKey && (
				<p role="alert" className="text-sm text-destructive">
					{t(actionData.errorKey, { list: actionData.list })}
				</p>
			)}
			<div className="overflow-x-auto bg-card border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-muted-foreground text-left border-b">
							<th className="p-2">{t("finance_stage.col.work_order")}</th>
							<th className="p-2">{t("finance_stage.col.aviso")}</th>
							<th className="p-2">{t("finance_schedule.area")}</th>
							<th className="p-2 text-right">
								{t("finance_stage.col.amount")}
							</th>
							<th className="p-2" />
						</tr>
					</thead>
					<tbody>
						{schedule.invoices.map((i) => (
							<tr key={i.id} className="border-b last:border-0">
								<td className="p-2 font-mono">
									<Link to={`/finance/pbcc/${i.id}`} className="underline">
										{i.controlNumber}
									</Link>
								</td>
								<td className="p-2">{i.avisoNumber ?? "—"}</td>
								<td className="p-2">{i.area?.[0] ?? "—"}</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(i.amount)}
								</td>
								<td className="p-2">
									{i.hasInvoicePdf && (
										<a
											href={`/finance/pbcc/${i.id}/invoice`}
											download
											className="underline"
										>
											{t("finance_schedule.download_invoice")}
										</a>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
