import { useTranslation } from "react-i18next"
import {
	ClaroInvoicesView,
	type InvoiceTabKey,
} from "~/components/claro-invoices-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ArmBStepRail } from "~/components/finance-step-rail"
import {
	claroInvoiceCounts,
	INVOICE_TABS,
	listInvoices,
	listToMake,
	makeInvoices,
	markLoaded,
} from "~/lib/claro-invoice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-ariba"

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const counts = await claroInvoiceCounts()
	const raw = new URL(request.url).searchParams.get("tab")
	const tab: InvoiceTabKey =
		INVOICE_TABS.find((t) => t === raw) ??
		(counts.toMake > 0
			? "to_make"
			: counts.notLoaded > 0
				? "not_loaded"
				: "to_make")
	return {
		counts,
		tab,
		toMake: tab === "to_make" ? await listToMake() : [],
		invoices: tab === "to_make" ? [] : await listInvoices(tab),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	if (intent === "make") {
		const poIds = form.getAll("poId").map(String)
		if (poIds.length === 0)
			return { errorKey: "claro_invoices.errors.none_selected" as const }
		return makeInvoices(
			poIds.map((poId) => ({
				poId,
				workMonth: String(form.get(`month-${poId}`) ?? "") || null,
			})),
			user.id,
		)
	}
	const ids = form.getAll("id").map(String)
	if (ids.length === 0)
		return { errorKey: "claro_invoices.errors.none_selected" as const }
	if (intent === "mark_loaded") return markLoaded(ids, user.id)
	throw new Response("Unknown intent", { status: 400 })
}

export default function ClaroInvoices({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const data = actionData as
		| { made: number; failed: number }
		| { marked: number }
		| { errorKey: "claro_invoices.errors.none_selected" }
		| undefined
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("finance_flow.arm_b.step.awaiting_ariba")}
			</h1>
			<ArmBStepRail current="AWAITING_ARIBA" />
			<ClaroInvoicesView
				{...loaderData}
				result={data && !("errorKey" in data) ? data : undefined}
				errorKey={data && "errorKey" in data ? data.errorKey : undefined}
			/>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
