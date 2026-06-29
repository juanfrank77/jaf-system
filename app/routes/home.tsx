import { useTranslation } from "react-i18next"
import type { Route } from "./+types/home"

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "JAF Operations" },
		{ name: "description", content: "JAF Operations System" },
	]
}

export default function Home() {
	const { t } = useTranslation()
	return (
		<main className="flex min-h-screen items-center justify-center">
			<h1 className="text-2xl font-bold">{t("hi")}</h1>
		</main>
	)
}
