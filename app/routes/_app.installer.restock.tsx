import { useTranslation } from "react-i18next"
import { Form, redirect, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerLoopRail } from "~/components/installer-loop-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { StepRail } from "~/components/step-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { canApproveRestock } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	buildRestockPrefill,
	createRestock,
	MAX_LINE_QTY,
} from "~/lib/restock.server"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { Route } from "./+types/_app.installer.restock"

// submitted -> (needs sign-off if above par) -> approved -> picked -> received
const TRAIL = ["SUBMITTED", "APPROVED", "PICKED", "RECEIVED"] as const
const TRAIL_WITH_SIGNOFF = [
	"SUBMITTED",
	"NEEDS_SIGNOFF",
	"APPROVED",
	"PICKED",
	"RECEIVED",
] as const

export const meta: Route.MetaFunction = () => [{ title: "Restock — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, [
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"ADMIN",
	])
	if (user.role === "INSTALLER") {
		const { van } = await requireInstaller(request)
		const [prefill, codes, own] = await Promise.all([
			van ? buildRestockPrefill(van.id) : Promise.resolve([]),
			getActiveMaterialCodes(),
			// The installer's own recent requests, so "did it go through" is not
			// a phone call.
			van
				? db.restockRequest.findMany({
						where: { vanId: van.id },
						orderBy: { submittedAt: "desc" },
						take: 5,
					})
				: Promise.resolve([]),
		])
		const requests = own.map((r) => {
			const lines =
				(r.lines as { serviceCodeId: string; qty: number }[] | null) ?? []
			return {
				id: r.id,
				status: r.status,
				submittedAt: r.submittedAt.toISOString(),
				lineCount: lines.length,
				units: lines.reduce((n, l) => n + l.qty, 0),
				// A sign-off step happened (or is pending) when it needed one.
				signoff: r.status === "NEEDS_SIGNOFF" || r.approvedById !== null,
			}
		})
		// Price-blind for installers: the picker needs only these fields.
		const serviceCodes = serviceCodesForRole(user.role, codes).map((c) => ({
			id: c.id,
			claroCode: c.claroCode,
			name: c.name,
			unit: c.unit,
		}))
		return {
			role: "INSTALLER" as const,
			van,
			prefill,
			serviceCodes,
			requests,
			pending: [],
		}
	}
	const pending = await db.restockRequest.findMany({
		where: { status: "NEEDS_SIGNOFF" },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
	})
	return {
		role: "SUPERVISOR" as const,
		van: null,
		prefill: [],
		serviceCodes: [],
		requests: [],
		pending,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, [
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"ADMIN",
	])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "approve") {
		if (!canApproveRestock(user.role)) throw redirect("/installer/restock")
		const id = form.get("id") as string
		// Atomic guard: only a restock still awaiting sign-off can be approved,
		// so a replayed/double-submitted approve can never flip an already
		// APPROVED or RECEIVED restock back to APPROVED.
		await db.restockRequest.updateMany({
			where: { id, status: "NEEDS_SIGNOFF" },
			data: { status: "APPROVED", approvedById: user.id },
		})
		return redirect("/installer/restock")
	}

	const { van } = await requireInstaller(request)
	if (!van) return { errorKey: "installer.no_van" as const }
	// A posted service code and quantity are otherwise trusted wholesale: a
	// forged serviceCodeId becomes a permanent phantom PICKUP movement, and a
	// non-integer qty passes qty > 0 but makes the restock unreleasable
	// (reconciliation in load-to-van.server.ts compares exact counts).
	const validCodeIds = new Set(
		(await getActiveMaterialCodes()).map((c) => c.id),
	)
	const lines = JSON.parse((form.get("lines") as string) || "[]").filter(
		(l: { serviceCodeId: string; qty: number }) =>
			validCodeIds.has(l.serviceCodeId) && Number.isInteger(l.qty) && l.qty > 0,
	)
	// Reject rather than silently submit an empty/all-invalid line set: a
	// restock with no lines still persists as a real SUBMITTED row (nothing
	// in createRestock's caller enforced this before), reaches the warehouse
	// release queue, and burns a signature on a no-op release.
	if (lines.length === 0) {
		return { errorKey: "installer_restock.errors.items_required" as const }
	}
	// Mirror createRestock's coalesced-total ceiling here so a quantity over
	// the maximum returns a graceful error instead of letting createRestock's
	// throw surface as an unhandled 500 with the internal message rendered
	// straight to the installer.
	const coalescedQty = new Map<string, number>()
	for (const l of lines as { serviceCodeId: string; qty: number }[]) {
		coalescedQty.set(
			l.serviceCodeId,
			(coalescedQty.get(l.serviceCodeId) ?? 0) + l.qty,
		)
	}
	if ([...coalescedQty.values()].some((qty) => qty > MAX_LINE_QTY)) {
		return { errorKey: "installer_restock.errors.qty_too_large" as const }
	}
	await createRestock(van.id, lines, { id: user.id })
	return redirect("/installer/restock?sent=1")
}

export default function InstallerRestock({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { role, van, prefill, serviceCodes, requests, pending } = loaderData
	const { t, i18n } = useTranslation()
	const [params] = useSearchParams()

	if (role !== "INSTALLER") {
		return (
			<div className="space-y-4">
				<h1 className="text-xl font-semibold">
					{t("restock.signoff_heading", "Restocks needing sign-off")}
				</h1>
				<ul className="divide-y">
					{pending.map((r) => (
						<li key={r.id} className="py-2 flex items-center justify-between">
							<span className="text-sm">
								{r.van.name} — {r.id.slice(-6)}
							</span>
							<Form method="post">
								<input type="hidden" name="intent" value="approve" />
								<input type="hidden" name="id" value={r.id} />
								<Button type="submit" size="sm">
									{t("restock.approve", "Approve")}
								</Button>
							</Form>
						</li>
					))}
					{pending.length === 0 && (
						<li className="py-2 text-sm text-muted-foreground">
							{t("restock.no_pending", "Nothing pending sign-off.")}
						</li>
					)}
				</ul>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<InstallerLoopRail current="RESTOCK" />
			<Callout title={t("installer.installer_flow.callout.restock_title")}>
				{t("installer.installer_flow.callout.restock_body")}
			</Callout>
			<h1 className="text-xl font-semibold">
				{t("installer.request_restock", "Request Restock")}
			</h1>
			{params.get("sent") === "1" && (
				<Callout tone="ok" icon="✓" title={t("installer_restock.sent_title")}>
					{t("installer_restock.sent_body")}
				</Callout>
			)}
			{van && (
				<p className="text-sm text-muted-foreground">
					{t("installer_restock.van_header", { van: van.name })}
				</p>
			)}
			{!van ? (
				<p className="text-sm text-status-warn">{t("installer.no_van")}</p>
			) : (
				<Form method="post" className="space-y-4">
					{actionData && "errorKey" in actionData && (
						<p className="text-sm text-status-danger">
							{t(actionData.errorKey)}
						</p>
					)}
					<MaterialLineItems
						serviceCodes={serviceCodes}
						initialItems={prefill}
						name="lines"
						touch
					/>
					<p className="text-xs text-muted-foreground">
						{t("installer_restock.tap_hint")}
					</p>
					<Button type="submit">
						{t("restock.submit", "Submit Restock Request")}
					</Button>
				</Form>
			)}

			{van && (
				<section className="space-y-2">
					<h2 className="text-sm font-medium">
						{t("installer.restock_requests_heading")}
					</h2>
					{requests.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("installer.no_restock_requests")}
						</p>
					) : (
						<ul className="space-y-3">
							{requests.map((r) => {
								const steps: readonly (typeof TRAIL_WITH_SIGNOFF)[number][] =
									r.signoff ? TRAIL_WITH_SIGNOFF : TRAIL
								return (
									<li
										key={r.id}
										className="space-y-2 rounded-lg border bg-card p-3"
									>
										<p className="text-sm">
											{new Date(r.submittedAt).toLocaleDateString(
												i18n.language,
											)}{" "}
											·{" "}
											{t("installer_restock.request_summary", {
												lines: r.lineCount,
												units: r.units,
											})}
										</p>
										<StepRail
											ariaLabel={t("installer_restock.trail_aria")}
											current={steps.indexOf(
												r.status === "DRAFT" ? "SUBMITTED" : r.status,
											)}
											compact
											steps={steps.map((s) => ({
												key: s,
												label: t(`installer_restock.status.${s}`),
											}))}
										/>
										{r.status === "NEEDS_SIGNOFF" && (
											<p className="text-sm font-medium text-status-warn">
												{t("installer_restock.needs_signoff_note")}
											</p>
										)}
									</li>
								)
							})}
						</ul>
					)}
				</section>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
