import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	LEDGER_REPORTS,
	type LedgerReportKey,
	LedgerView,
} from "~/components/ledger-view"
import { ledgerSummaries } from "~/lib/aviso-ledger.server"
import { parseRange } from "~/lib/ledger-range"
import {
	armAClock,
	claroAging,
	openMoney,
	waitingForPo,
} from "~/lib/ledger-reports"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.ledger"

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const { from, to, fromDate, toDate } = parseRange(
		url.searchParams.get("from"),
		url.searchParams.get("to"),
	)
	const report: LedgerReportKey =
		LEDGER_REPORTS.find((r) => r === url.searchParams.get("report")) ?? "ledger"
	const rows = await ledgerSummaries(fromDate, toDate)
	return {
		from,
		to,
		report,
		data: {
			rows,
			armA: armAClock(rows),
			waiting: waitingForPo(rows),
			aging: claroAging(rows),
			open: openMoney(rows),
		},
	}
}

export default function Ledger({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("ledger.title")}</h1>
			<LedgerView {...loaderData} />
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
