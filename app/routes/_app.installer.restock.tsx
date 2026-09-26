import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { canApproveRestock } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { buildRestockPrefill, createRestock } from "~/lib/restock.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
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
		const [prefill, codes] = await Promise.all([
			van ? buildRestockPrefill(van.id) : Promise.resolve([]),
			getActiveMaterialCodes(),
		])
		const serviceCodes = codes.map((c) => ({
			id: c.id,
			claroCode: c.claroCode,
			name: c.name,
			unit: c.unit,
			unitPrice: toNumberPrice(c.unitPrice),
		}))
		return {
			role: "INSTALLER" as const,
			van,
			prefill,
			serviceCodes,
			pending: [],
		}
	}
	const pending = await db.restockRequest.findMany({
		where: { status: "NEEDS_SIGNOFF" },
		include: { van: true },
		orderBy: { submittedAt: "desc" },
	})
	return {
		role: "SUPERVISOR" as const,
		van: null,
		prefill: [],
		serviceCodes: [],
		pending,
	}
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
	// A posted service code and quantity are otherwise trusted wholesale: a
	// forged serviceCodeId becomes a permanent phantom PICKUP movement, and a
	// non-integer qty passes qty > 0 but makes the restock unreleasable
	// (reconciliation in load-to-van.server.ts compares exact counts).
	const validCodeIds = new Set(
		(await getActiveMaterialCodes()).map((c) => c.id),
	)
	const lines = JSON.parse((form.get("lines") as string) || "[]").filter(
		(l: { serviceCodeId: string; qty: number }) =>
			validCodeIds.has(l.serviceCodeId) && Number.isInteger(l.qty) && l.qty > 0,
	)
	await createRestock(van.id, lines, { id: user.id })
	return redirect("/installer")
}

export default function InstallerRestock({ loaderData }: Route.ComponentProps) {
	const { role, van, prefill, serviceCodes, pending } = loaderData
	const { t } = useTranslation()

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
					<MaterialLineItems
						serviceCodes={serviceCodes}
						initialItems={prefill}
						name="lines"
					/>
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
