import { useTranslation } from "react-i18next"
import {
	type ClaroCloseError,
	ClaroCloseView,
} from "~/components/claro-close-view"
import { ClaroStepRail } from "~/components/claro-step-rail"
import { RouteErrorBoundary } from "~/components/error-boundary"
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
