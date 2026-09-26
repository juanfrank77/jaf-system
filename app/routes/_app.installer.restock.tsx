import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { canApproveRestock } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { buildRestockPrefill, createRestock } from "~/lib/restock.server"
import type { Route } from "./+types/_app.installer.restock"

export const meta: Route.MetaFunction = () => [{ title: "Restock — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, [
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"ADMIN",
	])
	if (user.role === "INSTALLER") {
		const { van } = await requireInstaller(request)
		const prefill = van ? await buildRestockPrefill(van.id) : []
		return { role: "INSTALLER" as const, van, prefill, pending: [] }
	}
	const pending = await db.restockRequest.findMany({
		where: { status: "NEEDS_SIGNOFF" },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
	})
	return { role: "SUPERVISOR" as const, van: null, prefill: [], pending }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, [
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"ADMIN",
	])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "approve") {
		if (!canApproveRestock(user.role)) throw redirect("/installer/restock")
		const id = form.get("id") as string
		// Atomic guard: only a restock still awaiting sign-off can be approved,
		// so a replayed/double-submitted approve can never flip an already
		// APPROVED or RECEIVED restock back to APPROVED.
		await db.restockRequest.updateMany({
			where: { id, status: "NEEDS_SIGNOFF" },
			data: { status: "APPROVED", approvedById: user.id },
		})
		return redirect("/installer/restock")
	}

	const { van } = await requireInstaller(request)
	if (!van) return { errorKey: "installer.no_van" as const }
	const lines = JSON.parse((form.get("lines") as string) || "[]")
	await createRestock(van.id, lines, { id: user.id })
	return redirect("/installer")
}

export default function InstallerRestock({ loaderData }: Route.ComponentProps) {
	const { role, van, prefill, pending } = loaderData
	const { t } = useTranslation()
	const [lines, setLines] = useState(prefill)

	function setQty(serviceCodeId: string, qty: number) {
		setLines((prev) =>
			prev.map((l) => (l.serviceCodeId === serviceCodeId ? { ...l, qty } : l)),
		)
	}

	if (role !== "INSTALLER") {
		return (
			<div className="space-y-4">
				<h1 className="text-xl font-semibold">
					{t("restock.signoff_heading", "Restocks needing sign-off")}
				</h1>
				<ul className="divide-y">
					{pending.map((r) => (
						<li key={r.id} className="py-2 flex items-center justify-between">
							<span className="text-sm">
								{r.van.name} — {r.id.slice(-6)}
							</span>
							<Form method="post">
								<input type="hidden" name="intent" value="approve" />
								<input type="hidden" name="id" value={r.id} />
								<Button type="submit" size="sm">
									{t("restock.approve", "Approve")}
								</Button>
							</Form>
						</li>
					))}
					{pending.length === 0 && (
						<li className="py-2 text-sm text-slate-500">
							{t("restock.no_pending", "Nothing pending sign-off.")}
						</li>
					)}
				</ul>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("installer.request_restock", "Request Restock")}
			</h1>
			{!van ? (
				<p className="text-sm text-amber-600">{t("installer.no_van")}</p>
			) : (
				<Form method="post" className="space-y-4">
					<input type="hidden" name="lines" value={JSON.stringify(lines)} />
					<ul className="space-y-2">
						{lines.map((l) => (
							<li key={l.serviceCodeId} className="flex items-center gap-2">
								<Label
									htmlFor={`qty-${l.serviceCodeId}`}
									className="flex-1 text-sm"
								>
									{l.serviceCodeId}
								</Label>
								<Input
									id={`qty-${l.serviceCodeId}`}
									type="number"
									min={0}
									className="w-24"
									value={l.qty}
									onChange={(e) =>
										setQty(l.serviceCodeId, Number(e.target.value) || 0)
									}
								/>
							</li>
						))}
						{lines.length === 0 && (
							<li className="text-sm text-slate-500">
								{t(
									"restock.empty_prefill",
									"No par levels set yet — add lines manually.",
								)}
							</li>
						)}
					</ul>
					<Button type="submit">
						{t("restock.submit", "Submit Restock Request")}
					</Button>
				</Form>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
