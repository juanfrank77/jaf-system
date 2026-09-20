import { useTranslation } from "react-i18next"
import { Outlet } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { LanguageSwitcher } from "~/library/language-switcher"

export default function AuthLayout() {
	const { t } = useTranslation()
	return (
		<div className="grid min-h-screen md:grid-cols-2">
			<div className="relative hidden md:block">
				<img
					src="/JAFCOM-tech-work-van.jpg"
					alt=""
					className="absolute inset-0 size-full object-cover object-[85%_center]"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/5" />
				<div className="relative flex h-full flex-col justify-end p-10 lg:p-14">
					<p className="max-w-sm text-2xl leading-snug font-semibold text-white">
						{t("login.tagline")}
					</p>
				</div>
			</div>
			<div className="relative flex items-center justify-center bg-background p-6 sm:p-10">
				<LanguageSwitcher className="absolute top-4 right-4" />
				<div className="w-full max-w-sm">
					<Outlet />
				</div>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: { error: unknown }) {
	return <RouteErrorBoundary error={error} />
}
