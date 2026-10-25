import { useTranslation } from "react-i18next"
import { Form, Link, useLocation, useSearchParams } from "react-router"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"

/**
 * What the system just did for the user (rule R1): shown after an automatic
 * step, read from the URL the step redirected to. Only the known keys render,
 * the link targets are fixed here, and the values are shown as plain text, so
 * a hand-typed URL can at worst show a cosmetic message.
 */
const RECEIPTS = {
	accepted: { to: "/finance/lc-requests", link: "view_batch" },
	closed: { to: null, link: null },
	sent: { to: "/finance/payroll", link: "go_payroll" },
	request_created: { to: null, link: null },
	request_sent: { to: "/finance/payroll?tab=waiting", link: "view_waiting" },
	paid: { to: null, link: null },
} as const

type ReceiptKey = keyof typeof RECEIPTS

export const receiptUrl = (
	path: string,
	key: ReceiptKey,
	values: Record<string, string | number | null | undefined> = {},
) => {
	const q = new URLSearchParams({ receipt: key })
	for (const [k, v] of Object.entries(values))
		if (v != null && v !== "") q.set(k, String(v))
	return `${path}${path.includes("?") ? "&" : "?"}${q}`
}

export function ReceiptBanner() {
	const { t } = useTranslation()
	const [params] = useSearchParams()
	const location = useLocation()
	const key = params.get("receipt")
	if (!key || !Object.hasOwn(RECEIPTS, key)) return null
	const receipt = RECEIPTS[key as ReceiptKey]
	const values = {
		a: params.get("a") ?? "",
		b: params.get("b") ?? "",
		c: params.get("c") ?? "",
		n: params.get("n") ?? "0",
	}
	const messages: Record<ReceiptKey, string> = {
		accepted: t("receipt.accepted", values),
		closed: t("receipt.closed", values),
		sent: t("receipt.sent", values),
		request_created: t("receipt.request_created", values),
		request_sent: t("receipt.request_sent", values),
		paid: t("receipt.paid", values),
	}
	const links = {
		view_batch: t("receipt.view_batch"),
		go_payroll: t("receipt.go_payroll"),
		view_waiting: t("receipt.view_waiting"),
	}
	const undo = params.get("undo")
	const rest = new URLSearchParams(params)
	for (const k of ["receipt", "a", "b", "c", "n", "undo", "reviewed", "left"])
		rest.delete(k)
	const dismiss = `${location.pathname}${rest.size ? `?${rest}` : ""}`
	return (
		<Callout title={`✓ ${messages[key as ReceiptKey]}`} tone="ok">
			<span className="inline-flex flex-wrap items-center gap-3 align-middle">
				{params.get("reviewed") ? (
					<span>
						{t("receipt.counter", {
							reviewed: params.get("reviewed") ?? "0",
							left: params.get("left") ?? "0",
						})}
					</span>
				) : null}
				{receipt.to && receipt.link ? (
					<Link to={receipt.to} className="underline">
						{links[receipt.link]}
					</Link>
				) : null}
				{key === "accepted" && undo ? (
					<Form method="post" action={`/finance/verify/${undo}`}>
						<input type="hidden" name="intent" value="undo_accept" />
						<Button type="submit" variant="outline" size="sm">
							{t("receipt.undo")}
						</Button>
					</Form>
				) : null}
				<Link to={dismiss} replace className="text-muted-foreground underline">
					{t("receipt.dismiss")}
				</Link>
			</span>
		</Callout>
	)
}
