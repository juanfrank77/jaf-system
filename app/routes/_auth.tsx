import { Outlet } from "react-router"
import { LanguageSwitcher } from "~/library/language-switcher"

export default function AuthLayout() {
	return (
		<div className="min-h-screen bg-slate-50 flex items-center justify-center">
			<LanguageSwitcher className="fixed top-4 right-4" />
			<div className="w-full max-w-sm">
				<Outlet />
			</div>
		</div>
	)
}
