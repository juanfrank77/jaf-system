import { useTranslation } from "react-i18next"
import { isRouteErrorResponse, Link } from "react-router"
import { Card, CardContent } from "~/components/ui/card"

interface RouteErrorBoundaryProps {
	error: unknown
}

export function RouteErrorBoundary({ error }: RouteErrorBoundaryProps) {
	return <ErrorFallback error={error} />
}

interface ErrorFallbackProps {
	error?: unknown
}

function ErrorFallback({ error }: ErrorFallbackProps) {
	const { t } = useTranslation()
	let title = t("error.500.title")
	let message = t("error.500.description")
	let stack: string | undefined

	if (isRouteErrorResponse(error)) {
		title = error.status === 404 ? t("error.404.title") : "Error"
		message =
			error.status === 404
				? t("error.404.description")
				: error.statusText || message
	} else if (error instanceof Error) {
		message = error.message
		if (import.meta.env.DEV) {
			stack = error.stack
		}
	}

	return (
		<main className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center p-4">
			<Card className="w-full max-w-2xl">
				<CardContent className="space-y-6 p-6 text-center">
					<h1 className="text-4xl font-bold">{title}</h1>
					<p className="text-lg text-muted-foreground">{message}</p>
					{stack && (
						<pre className="overflow-x-auto rounded-lg bg-muted p-4 text-left text-sm">
							<code>{stack}</code>
						</pre>
					)}
					<div>
						<Link
							to="/"
							className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90"
						>
							{t("navigation.home")}
						</Link>
					</div>
				</CardContent>
			</Card>
		</main>
	)
}
