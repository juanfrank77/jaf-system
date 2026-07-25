import { useTranslation } from "react-i18next"
import { data, Link } from "react-router"
import type { Route } from "./+types/$"

export const meta: Route.MetaFunction = () => [{ title: "Not Found — JAF Ops" }]

export function loader(_: Route.LoaderArgs) {
	return data(null, { status: 404 })
}

export default function Route404() {
	const { t } = useTranslation()
	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-2xl text-center">
				<h1 className="mb-4 text-6xl font-bold">404</h1>
				<h2 className="mb-4 text-3xl font-semibold">{t("error.404.title")}</h2>
				<p className="mb-8 text-lg">{t("error.404.description")}</p>
				<Link
					to="/"
					className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-6 py-3 text-white hover:bg-indigo-700"
				>
					{t("navigation.home")}
				</Link>
			</div>
		</div>
	)
}
