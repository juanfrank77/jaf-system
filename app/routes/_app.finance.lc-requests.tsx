import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import {
	type BatchTab,
	PbccBatchListView,
	PbccBatchOpenView,
	PbccBatchTabs,
} from "~/components/pbcc-batch-open"
import { Callout } from "~/components/ui/callout"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import {
	BatchError,
	closeOpenBatch,
	getOpenBatch,
	takeOutRow,
} from "~/lib/pbcc-batch.server"
import { listBatches, loadBatchView } from "~/lib/pbcc-batch-view.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.lc-requests"

export const meta: Route.MetaFunction = () => [
	{ title: "PBCC batch — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const raw = new URL(request.url).searchParams.get("tab")
	const tab: BatchTab = raw === "sent" || raw === "ready" ? raw : "open"
	// There is always one open batch; this is where it is first made.
	const open = await getOpenBatch(user.id)
	const readyCount = (await listBatches(["closed"])).length
	if (tab !== "open")
		return {
			user,
			tab,
			batch: null,
			batches: await listBatches([tab === "ready" ? "closed" : "sent"]),
			readyCount,
		}
	return {
		user,
		tab,
		batch: await loadBatchView(open.id),
		batches: [],
		readyCount,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "close_batch") {
			// Land on the batch just closed, with its check and Download / Mark sent.
			const batchId = String(form.get("batchId") ?? "")
			await closeOpenBatch({ batchId, userId: user.id })
			return redirect(`/finance/schedules/${batchId}`)
		}
		if (intent === "take_out") {
			await takeOutRow({
				docId: String(form.get("docId") ?? ""),
				reason: String(form.get("reason") ?? ""),
				userId: user.id,
			})
			return { ok: true as const }
		}
	} catch (e) {
		if (!(e instanceof BatchError)) throw e
		return {
			ok: false as const,
			errorKey: `pbcc_batch.errors.${e.code}` as const,
			list: e.controlNumbers.join(", "),
		}
	}
	return {
		ok: false as const,
		errorKey: "pbcc_batch.errors.unknown_intent" as const,
		list: "",
	}
}

export default function FinancePbccBatch({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { tab, batch, batches, readyCount } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lc_request")}
				</h1>
				<StageChip arm="A" step={2} total={FINANCE_STEPS.length} />
			</div>
			<FinanceStepRail current="LC_REQUEST" />
			<Callout title={t("finance_flow.callout.lc_request_title")}>
				{t("finance_flow.callout.lc_request_body")}
			</Callout>
			<PbccBatchTabs tab={tab} readyCount={readyCount} />
			{tab === "open" && batch ? (
				<PbccBatchOpenView batch={batch} action={actionData} />
			) : (
				<PbccBatchListView
					batches={batches}
					empty={t(
						tab === "ready" ? "pbcc_batch.none_ready" : "pbcc_batch.none_sent",
					)}
				/>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
