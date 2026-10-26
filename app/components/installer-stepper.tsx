import { useTranslation } from "react-i18next"
import { Link } from "react-router"

const STEPS = [
	{ key: "warranty", to: "/comptroller/installers" },
	{ key: "ewit", to: "/comptroller/installers/ewit" },
	{ key: "batch", to: "/comptroller/installers/batches" },
	{ key: "received", to: "/comptroller/installers/batches" },
	{ key: "pay", to: "/comptroller/installers/pay" },
] as const

/** The five steps of Carmen's installer week; every installer screen carries it. */
export function InstallerStepper({
	current,
}: {
	current: (typeof STEPS)[number]["key"]
}) {
	const { t } = useTranslation()
	const labels = {
		warranty: t("installers.stepper.warranty"),
		ewit: t("installers.stepper.ewit"),
		batch: t("installers.stepper.batch"),
		received: t("installers.stepper.received"),
		pay: t("installers.stepper.pay"),
	}
	return (
		<ol className="flex flex-wrap gap-2 text-sm">
			{STEPS.map((s, i) => (
				<li key={s.key}>
					<Link
						to={s.to}
						aria-current={s.key === current ? "step" : undefined}
						className={
							s.key === current
								? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
								: "rounded-md bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground"
						}
					>
						{i + 1} {labels[s.key]}
					</Link>
				</li>
			))}
		</ol>
	)
}
