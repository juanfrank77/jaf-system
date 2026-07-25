import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import { cn } from "~/lib/utils"
import { type Language, supportedLanguages } from "~/localization/resource"

const LANGUAGE_LABELS: Record<Language, string> = {
	en: "EN",
	es: "ES",
}

const LanguageSwitcher = ({ className }: { className?: string }) => {
	const { t, i18n } = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would render an unwanted browser default border/legend for this segmented pill control
		<div
			role="group"
			aria-label={t("language.switcher_label")}
			className={cn(
				"inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5",
				className,
			)}
		>
			{supportedLanguages.map((language) => {
				const active = i18n.language === language
				return (
					<button
						key={language}
						type="button"
						aria-pressed={active}
						lang={language}
						onClick={() => {
							i18n.changeLanguage(language)
							navigate(`${location.pathname}?lng=${language}`, {
								replace: true,
							})
						}}
						className={cn(
							"rounded-full px-2.5 py-1 text-xs font-semibold transition-all",
							active
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{LANGUAGE_LABELS[language]}
					</button>
				)
			})}
		</div>
	)
}

export { LanguageSwitcher }
