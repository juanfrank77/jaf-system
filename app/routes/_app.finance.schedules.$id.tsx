import { useTranslation } from "react-i18next"
import { redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { PbccBatchDetailView } from "~/components/pbcc-batch-detail"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
import { db } from "~/lib/db.server"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import { BatchError, checkBatch, markBatchSent } from "~/lib/pbcc-batch.server"
import { loadBatchView } from "~/lib/pbcc-batch-view.server"
import { planPackage } from "~/lib/pbcc-package.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.schedules.$id"

export const meta: Route.MetaFunction = () => [
	{ title: "PBCC batch — JAF Ops" },
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const batch = await loadBatchView(params.id)
	if (!batch) throw new Response("Not found", { status: 404 })
	// The open batch has its own screen.
	if (batch.status === "open") throw redirect("/finance/lc-requests")
	const plan = batch.hasExcel ? await planPackage(batch.id) : []
	return {
		user,
		batch,
		// A sent batch is not re-checked: it can no longer change.
		check: batch.status === "closed" ? await checkBatch(batch.id) : null,
		parts: plan.map((p) => ({
			part: p.part,
			of: p.of,
			rowFrom: p.rowFrom,
			rowTo: p.rowTo,
			megabytes: p.bytes / (1024 * 1024),
			hasExcel: p.hasExcel,
			subject: p.subject,
		})),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "mark_sent")
		return {
			ok: false as const,
			errorKey: "pbcc_batch.errors.unknown_intent" as const,
			list: "",
		}
	try {
		const { alreadySent } = await markBatchSent({
			batchId: params.id,
			sentById: user.id,
		})
		if (alreadySent) return { ok: true as const, errorKey: undefined, list: "" }
		const sent = await db.bankSchedule.findUniqueOrThrow({
			where: { id: params.id },
			select: { number: true, _count: { select: { invoices: true } } },
		})
		return redirect(
			receiptUrl(`/finance/schedules/${params.id}`, "sent", {
				a: sent.number,
				n: sent._count.invoices,
			}),
		)
	} catch (e) {
		if (!(e instanceof BatchError)) throw e
		if (e.code === "not_found") throw new Response("Not found", { status: 404 })
		return {
			ok: false as const,
			errorKey: `pbcc_batch.errors.${e.code}` as const,
			list: e.controlNumbers.join(", "),
		}
	}
}

export default function PbccBatchPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { batch, check, parts } = loaderData
	const { t } = useTranslation()
	const navigation = useNavigation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lc_request")}
				</h1>
				<StageChip arm="A" step={2} total={FINANCE_STEPS.length} />
			</div>
			<FinanceStepRail current="LC_REQUEST" />
			<ReceiptBanner />
			<PbccBatchDetailView
				batch={batch}
				check={check}
				parts={parts}
				action={actionData}
				submitting={navigation.state === "submitting"}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
