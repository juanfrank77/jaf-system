import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import { supportedLanguages } from "~/localization/resource"

const LanguageSwitcher = () => {
	const { i18n } = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	return (
		<div className="fixed top-0 right-0 z-10 flex gap-2 p-2">
			{supportedLanguages.map((language) => (
				<button
					key={language}
					type="button"
					className="text-blue-500 transition-all hover:underline"
					onClick={() => {
						i18n.changeLanguage(language)
						navigate(`${location.pathname}?lng=${language}`, { replace: true })
					}}
				>
					{language}
				</button>
			))}
		</div>
	)
}

export { LanguageSwitcher }
