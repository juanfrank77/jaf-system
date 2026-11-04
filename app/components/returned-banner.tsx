import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"

/** What the job and review pages pass down for a packet Finance sent back. */
export type ReturnedInfo = {
	note: string
	/** Who sent it back; null when the user row is gone. */
	byName: string | null
	createdAt: string
}

/**
 * The red banner at the top of a returned packet: who sent it back and when,
 * her note word for word, and the way to the step that fixes it (omitted when
 * the supervisor is already on that step).
 */
export function ReturnedBanner({
	returned,
	fixHref,
}: {
	returned: ReturnedInfo
	fixHref: string | null
}) {
	const { t } = useTranslation()
	return (
		<div data-testid="returned-banner" className="space-y-2">
			<Callout
				tone="danger"
				title={t("returned_packet.banner_title", {
					name: returned.byName ?? t("returned_packet.unknown_user"),
					date: new Date(returned.createdAt).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					}),
				})}
			>
				<span className="block whitespace-pre-line">{returned.note}</span>
			</Callout>
			{fixHref && (
				<Link
					to={fixHref}
					className={buttonVariants({ className: "w-full sm:w-auto" })}
				>
					{t("returned_packet.fix_button")}
				</Link>
			)}
		</div>
	)
}
