import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { pageTitle } from "~/lib/page-title"
import type { Route } from "./+types/_auth.crew-notice"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.crew_notice") },
]

/** Where every app page sends a CREW session: crew accounts no longer sign
 * in, the supervisor enters the brigade's field work. Static on purpose. */
export default function CrewNotice() {
	const { t } = useTranslation()
	return (
		<div className="space-y-4 text-center">
			<h1 className="text-2xl font-bold">{t("crew_notice.title")}</h1>
			<p className="text-sm text-muted-foreground">{t("crew_notice.body")}</p>
			<Form method="post" action="/sign-out">
				<Button type="submit" className="w-full">
					{t("app_shell.sign_out")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
