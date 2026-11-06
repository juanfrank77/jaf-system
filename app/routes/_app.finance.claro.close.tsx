import { useTranslation } from "react-i18next"
import {
	type ClaroCloseError,
	ClaroCloseView,
} from "~/components/claro-close-view"
import { ClaroStepRail } from "~/components/claro-step-rail"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { isOtherJafRef } from "~/lib/advice-parse"
import { addOldInvoice, ClaroInvoiceError } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import {
	AdviceError,
	acceptShort,
	applyAdvice,
	ingestAdvice,
	linkLine,
	listAdvices,
	listUnmatched,
} from "~/lib/payment-advice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.claro.close"

/** What adding an old invoice from a statement line can go wrong with. */
const OLD_ERRORS: Partial<Record<ClaroInvoiceError["code"], ClaroCloseError>> =
	{
		not_old_number: "claro.errors.not_old_number",
		number_taken: "claro.errors.number_taken",
		po_not_available: "claro.errors.po_not_available",
		bad_total: "claro.errors.bad_total",
	}

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const [advices, applied, unmatched] = await Promise.all([
		listAdvices(false, "m19"),
		listAdvices(true, "m19"),
		listUnmatched("m19"),
	])
	// Paid short and not yet accepted: stays on screen until she decides.
	const shorts = applied.flatMap((a) =>
		a.lines
			.filter((l) => l.needsAccept && l.invoiceId)
			.map((l) => ({ ...l, adviceDate: a.adviceDate })),
	)
	return { advices, unmatched, shorts }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "upload") {
			const file = form.get("file")
			if (!(file instanceof File) || file.size === 0)
				return { errorKey: "payment_advice.errors.no_file" as const }
			if (!validateFile(file, "pdf").valid)
				return { errorKey: "payment_advice.errors.not_pdf" as const }
			const { id } = await ingestAdvice(
				{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				user.id,
			)
			return { adviceId: id }
		}
		if (intent === "apply") {
			await applyAdvice(String(form.get("adviceId")), user.id, "m19")
		} else if (intent === "link") {
			await linkLine(
				String(form.get("lineId")),
				String(form.get("invoice")),
				user.id,
			)
		} else if (intent === "add_old") {
			// An old M19 Claro paid that was never entered here: enter it from the
			// line itself, and the line then matches (and pays, once reviewed).
			const line = await db.adviceLine.findUnique({
				where: { id: String(form.get("lineId")) },
				select: { invoiceRef: true, net: true, result: true },
			})
			if (!line) throw new AdviceError("not_found")
			if (isOtherJafRef(line.invoiceRef))
				return { errorKey: "claro.errors.ja_line" as const }
			if (line.result !== "UNMATCHED")
				throw new AdviceError("line_not_unmatched")
			await addOldInvoice({
				number: line.invoiceRef,
				total: Number(line.net),
				poNumber: null,
				loadedAt: null,
				userId: user.id,
			})
		} else if (intent === "accept_short") {
			await acceptShort(
				String(form.get("invoiceId")),
				String(form.get("reason") ?? ""),
				user.id,
			)
		} else {
			throw new Response("Unknown intent", { status: 400 })
		}
		return {}
	} catch (e) {
		if (e instanceof AdviceError)
			return { errorKey: `payment_advice.errors.${e.code}` as ClaroCloseError }
		if (e instanceof ClaroInvoiceError && OLD_ERRORS[e.code])
			return { errorKey: OLD_ERRORS[e.code] as ClaroCloseError }
		throw e
	}
}

export default function ClaroClose({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("claro.close.title")}</h1>
			<ClaroStepRail current={5} />
			<ClaroCloseView
				{...loaderData}
				errorKey={
					actionData && "errorKey" in actionData
						? actionData.errorKey
						: undefined
				}
				readId={
					actionData && "adviceId" in actionData
						? actionData.adviceId
						: undefined
				}
			/>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
