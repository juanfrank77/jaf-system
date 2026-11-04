import { useTranslation } from "react-i18next"
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"

type SignerGroup = {
	brigadeId: string
	brigadeName: string
	brigadeCode: string | null
	signers: { key: string; name: string }[]
}

/** The people of every brigade on the job, grouped by brigade. */
export function CrewSignerSelect({
	groups,
	value,
	onChange,
}: {
	groups: SignerGroup[]
	value: string
	onChange: (key: string) => void
}) {
	const { t } = useTranslation()
	if (groups.length === 0)
		return (
			<p
				className="mt-1 flex h-11 items-center rounded-md border bg-muted/40 px-3 text-base"
				data-testid="pickup-signer"
			>
				—
			</p>
		)
	return (
		<Select
			items={groups.flatMap((g) =>
				g.signers.map((s) => ({ value: s.key, label: s.name })),
			)}
			value={value}
			onValueChange={(v) => onChange(v ?? "")}
		>
			<SelectTrigger
				className="mt-1 h-11 w-full text-base"
				data-testid="pickup-signer"
			>
				<SelectValue placeholder={t("docs_sign.crew_signer_placeholder")} />
			</SelectTrigger>
			<SelectContent>
				{groups.map((g) => (
					<SelectGroup key={g.brigadeId}>
						<SelectLabel>
							{g.brigadeCode
								? `${g.brigadeName} (${g.brigadeCode})`
								: g.brigadeName}
						</SelectLabel>
						{g.signers.map((s) => (
							<SelectItem key={s.key} value={s.key}>
								{s.name}
							</SelectItem>
						))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	)
}
