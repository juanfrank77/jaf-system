import { useTranslation } from "react-i18next"
import {
	ClaroInvoicesView,
	type InvoiceErrorKey,
	type InvoiceTabKey,
} from "~/components/claro-invoices-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ArmBStepRail } from "~/components/finance-step-rail"
import {
	addOldInvoice,
	ClaroInvoiceError,
	claroInvoiceCounts,
	INVOICE_TABS,
	listInvoices,
	listToMake,
	makeInvoices,
	markLoaded,
} from "~/lib/claro-invoice.server"
import { requireRole } from "~/lib/permissions.server"
import { getInvoiceSignature } from "~/lib/system-settings.server"
import type { Route } from "./+types/_app.finance.awaiting-ariba"

const OLD_ERRORS = {
	not_old_number: "claro_invoices.errors.not_old_number",
	number_taken: "claro_invoices.errors.number_taken",
	po_not_available: "claro_invoices.errors.po_not_available",
	bad_total: "claro_invoices.errors.bad_total",
} as Record<string, InvoiceErrorKey>

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const counts = await claroInvoiceCounts()
	const params = new URL(request.url).searchParams
	const raw = params.get("tab")
	const oldNumber = params.get("old")
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
		// A Payment Advice row or a PO opens the old-invoice form filled in.
		oldPrefill:
			oldNumber !== null
				? {
						number: oldNumber,
						amount: params.get("amount") ?? "",
						po: params.get("po") ?? "",
					}
				: null,
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
		if (!(await getInvoiceSignature()))
			return { errorKey: "claro_invoices.errors.no_signature" as const }
		return makeInvoices(
			poIds.map((poId) => ({
				poId,
				workMonth: String(form.get(`month-${poId}`) ?? "") || null,
			})),
			user.id,
		)
	}
	if (intent === "add_old") {
		const number = String(form.get("number") ?? "").trim()
		const loadedOn = String(form.get("loadedOn") ?? "")
		try {
			await addOldInvoice({
				number,
				total: Number(String(form.get("total") ?? "").replace(/[$,\s]/g, "")),
				poNumber: String(form.get("po") ?? "").trim() || null,
				loadedAt: loadedOn ? new Date(`${loadedOn}T12:00:00Z`) : null,
				userId: user.id,
			})
		} catch (e) {
			if (!(e instanceof ClaroInvoiceError)) throw e
			return { errorKey: OLD_ERRORS[e.code] ?? OLD_ERRORS.not_old_number }
		}
		return { addedOld: number.toUpperCase() }
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
		| { addedOld: string }
		| { errorKey: InvoiceErrorKey }
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
