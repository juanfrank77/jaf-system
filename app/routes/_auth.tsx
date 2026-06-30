import { Outlet } from "react-router"

export default function AuthLayout() {
	return (
		<div className="min-h-screen bg-slate-50 flex items-center justify-center">
			<div className="w-full max-w-sm">
				<Outlet />
			</div>
		</div>
	)
}
