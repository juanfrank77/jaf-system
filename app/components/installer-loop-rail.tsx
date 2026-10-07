import { useTranslation } from "react-i18next"
import {
	INSTALLER_LOOP_HREF,
	INSTALLER_LOOP_LABEL_KEY,
	INSTALLER_LOOP_STEPS,
	type InstallerLoopStep,
} from "~/lib/installer-steps"
import { StepRail } from "./step-rail"

// The installer's phone loop rail. Every step is the installer's own
// work (`mine`), every reached screen links back to it, and the screen
// you are on is the current step.
export function InstallerLoopRail({ current }: { current: InstallerLoopStep }) {
	const { t } = useTranslation()
	const index = INSTALLER_LOOP_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("installer.installer_flow.aria")}
			current={index}
			steps={INSTALLER_LOOP_STEPS.map((step, i) => ({
				key: step,
				href: i === index ? undefined : INSTALLER_LOOP_HREF[step],
				label: t(INSTALLER_LOOP_LABEL_KEY[step]),
				mine: true,
			}))}
		/>
	)
}
