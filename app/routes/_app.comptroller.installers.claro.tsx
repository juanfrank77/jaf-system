import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerStepper } from "~/components/installer-stepper"
import {
	type AdviceErrorKey,
	type AdviceTabKey,
	PaymentAdviceView,
} from "~/components/payment-advice-view"
import { validateFile } from "~/lib/file-upload.server"
import {
	AdviceError,
	acceptJaShort,
	adviceCounts,
	applyAdvice,
	ingestAdvice,
	listAdvices,
	listUnmatched,
	rematchJaLines,
} from "~/lib/payment-advice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.installers.claro"

export const meta: Route.MetaFunction = () => [
	{ title: "Claro payments — JAF Ops" },
]

const TABS: AdviceTabKey[] = ["upload", "applied", "unmatched"]

/** Carmen's side of Claro's Payment Advice: only the JA (installer invoice) rows. */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	// A PO added since the upload may let a waiting JA row find its invoice.
	await rematchJaLines()
	const counts = await adviceCounts("ja")
	const raw = new URL(request.url).searchParams.get("tab")
	const tab: AdviceTabKey = TABS.find((t) => t === raw) ?? "upload"
	return {
		counts,
		tab,
		advices:
			tab === "unmatched" ? [] : await listAdvices(tab === "applied", "ja"),
		unmatched: tab === "unmatched" ? await listUnmatched("ja") : [],
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "upload") {
			const file = form.get("file")
			if (!(file instanceof File) || file.size === 0)
				return { errorKey: "payment_advice.errors.no_file" as const }
			if (!validateFile(file, "pdf").valid)
				return { errorKey: "payment_advice.errors.not_pdf" as const }
			await ingestAdvice(
				{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				user.id,
			)
		} else if (intent === "apply") {
			await applyAdvice(String(form.get("adviceId")), user.id, "ja")
		} else if (intent === "accept_ja_short") {
			await acceptJaShort(
				String(form.get("lineId")),
				String(form.get("reason") ?? ""),
				user.id,
			)
		} else {
			throw new Response("Unknown intent", { status: 400 })
		}
		return {}
	} catch (e) {
		if (e instanceof AdviceError)
			return { errorKey: `payment_advice.errors.${e.code}` as AdviceErrorKey }
		throw e
	}
}

export default function ClaroPayments({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4 p-6">
			<h1 className="text-2xl font-bold">{t("installers.claro.title")}</h1>
			<InstallerStepper current="claro" />
			<PaymentAdviceView
				{...loaderData}
				kind="ja"
				errorKey={actionData?.errorKey}
			/>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
