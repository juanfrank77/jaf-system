import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import {
	buildBankSchedule,
	ScheduleValidationError,
} from "~/lib/bank-schedule.server"
import { db } from "~/lib/db.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { loadStageRows } from "~/lib/finance-stage-rows.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.lc-requests"

export const meta: Route.MetaFunction = () => [
	{ title: "LC request — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const { rows, totalCount } = await loadStageRows({
		stage: "LC_REQUEST",
		page,
		pageSize: PAGE_SIZE,
		ageFrom: "released",
	})
	// Packets already claimed by a schedule still match the LC request stage
	// until the schedule is sent; they must not be selectable again.
	const claimed = await db.jafInvoice.findMany({
		where: { id: { in: rows.map((r) => r.id) }, bankScheduleId: { not: null } },
		select: { id: true, bankSchedule: { select: { id: true, number: true } } },
	})
	const scheduleByPacket: Record<string, { id: string; number: number }> = {}
	for (const c of claimed)
		if (c.bankSchedule)
			scheduleByPacket[c.id] = {
				id: c.bankSchedule.id,
				number: c.bankSchedule.number,
			}
	const schedules = await db.bankSchedule.findMany({
		orderBy: { generatedAt: "desc" },
		take: 5,
		select: { id: true, number: true, sentAt: true, total: true },
	})
	return {
		user,
		jobs: rows,
		scheduleByPacket,
		schedules: schedules.map((s) => ({
			id: s.id,
			number: s.number,
			sentAt: s.sentAt?.toISOString() ?? null,
			total: Number(s.total),
		})),
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "build_schedule")
		return { errorKey: "finance_payroll.errors.unknown_intent" as const }
	const packetIds = form
		.getAll("packetId")
		.filter((v): v is string => typeof v === "string" && v !== "")
	let scheduleId: string
	try {
		;({ scheduleId } = await buildBankSchedule({
			packetIds,
			generatedById: user.id,
		}))
	} catch (e) {
		if (!(e instanceof ScheduleValidationError)) throw e
		switch (e.code) {
			case "empty":
			case "not_found":
			case "not_eligible":
			case "already_scheduled":
			case "no_area":
				return {
					errorKey: `finance_schedule.errors.${e.code}` as const,
					list: e.controlNumbers.join(", "),
				}
			default:
				return {
					errorKey: "finance_schedule.errors.not_eligible" as const,
					list: e.controlNumbers.join(", "),
				}
		}
	}
	throw redirect(`/finance/schedules/${scheduleId}`)
}

export default function FinanceLcRequests({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { jobs, pagination, scheduleByPacket, schedules } = loaderData
	const { t } = useTranslation()
	const [ticked, setTicked] = useState<Set<string>>(new Set())
	const selectedCount = jobs.filter((r) => ticked.has(r.id)).length
	const toggle = (id: string, on: boolean) =>
		setTicked((prev) => {
			const next = new Set(prev)
			if (on) next.add(id)
			else next.delete(id)
			return next
		})
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lc_request")}
				</h1>
				<StageChip arm="A" step={2} total={5} />
			</div>
			<FinanceStepRail current="LC_REQUEST" />
			<Callout title={t("finance_flow.callout.lc_request_title")}>
				{t("finance_flow.callout.lc_request_body")}
			</Callout>
			{jobs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<>
					<Form
						id="schedule-form"
						method="post"
						className="flex items-center gap-3"
					>
						<input type="hidden" name="intent" value="build_schedule" />
						<Button type="submit" disabled={selectedCount === 0}>
							{t("finance_schedule.build", { count: selectedCount })}
						</Button>
						{actionData?.errorKey && (
							<p role="alert" className="text-sm text-status-danger">
								{t(actionData.errorKey as never, {
									list: (actionData as { list?: string }).list,
								})}
							</p>
						)}
					</Form>
					<FinanceStageTable
						rows={jobs}
						to={(r) => `/finance/pbcc/${r.id}`}
						ageLabelKey="finance_stage.age.packets"
						action={(r) => {
							const s = scheduleByPacket[r.id]
							if (s)
								return (
									<Link to={`/finance/schedules/${s.id}`} className="underline">
										{t("finance_schedule.on_schedule", { number: s.number })}
									</Link>
								)
							return (
								<span className="flex items-center gap-3">
									<input
										type="checkbox"
										name="packetId"
										value={r.id}
										form="schedule-form"
										aria-label={r.controlNumber}
										checked={ticked.has(r.id)}
										onChange={(e) => toggle(r.id, e.target.checked)}
									/>
									<Link to={`/finance/pbcc/${r.id}`} className="underline">
										{t("finance_stage.build_request")}
									</Link>
								</span>
							)
						}}
					/>
				</>
			)}
			<StagePagination
				basePath="/finance/lc-requests"
				pagination={pagination}
				pageSize={PAGE_SIZE}
			/>
			{schedules.length > 0 && (
				<div className="space-y-1">
					<h2 className="text-sm font-semibold">
						{t("finance_schedule.recent")}
					</h2>
					<ul className="text-sm space-y-1">
						{schedules.map((s) => (
							<li key={s.id}>
								<Link to={`/finance/schedules/${s.id}`} className="underline">
									#{s.number}
								</Link>{" "}
								<span className="text-muted-foreground">
									{formatMoney(s.total)} ·{" "}
									{s.sentAt
										? t("finance_schedule.sent_on", {
												date: new Date(s.sentAt).toLocaleDateString("en-US", {
													timeZone: "America/Puerto_Rico",
												}),
											})
										: t("finance_schedule.not_sent")}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
