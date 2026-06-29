import { useTranslation } from "react-i18next"
import { supportedLanguages } from "~/localization/resource"

const LanguageSwitcher = () => {
	const { i18n } = useTranslation()

	return (
		<div className="fixed top-0 right-0 z-10 flex gap-2 p-2">
			{supportedLanguages.map((language) => (
				<button
					key={language}
					type="button"
					className="text-blue-500 transition-all hover:underline"
					onClick={() => i18n.changeLanguage(language)}
				>
					{language}
				</button>
			))}
		</div>
	)
}

export { LanguageSwitcher }
