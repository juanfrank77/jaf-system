import { useTranslation } from "react-i18next"
import { CrewPaymentNote } from "~/components/crew-picker"

type AssignedBrigade = {
	id: string
	name: string
	code: string | null
}

/**
 * The work order's crew as one row: the brigades, with individual members in muted text when there are any. Hidden
 * when nothing is assigned, so there is never an empty "Crew:" line.
 */
export function AssignedCrew({
	brigades,
	memberNames,
}: {
	brigades: AssignedBrigade[]
	memberNames: string[]
}) {
	const { t } = useTranslation()
	if (brigades.length === 0 && memberNames.length === 0) return null
	const shared = brigades.length > 1
	return (
		<div className="space-y-2">
			<p>
				<span className="text-muted-foreground">{t("docs_view.crew")}:</span>{" "}
				{brigades.map((b, i) => (
					<span key={b.id}>
						{i > 0 && ", "}
						{b.name}
						{b.code ? ` · ${b.code}` : ""}
					</span>
				))}
				{memberNames.length > 0 && (
					<span className="text-muted-foreground">
						{brigades.length > 0 ? " — " : ""}
						{memberNames.join(", ")}
					</span>
				)}
			</p>
			{shared && <CrewPaymentNote />}
		</div>
	)
}
