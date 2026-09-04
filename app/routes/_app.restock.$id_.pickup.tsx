import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.restock.$id_.pickup"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `Restock #${(data as { request: { id: string } }).request.id.slice(-6)} — Pickup — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const requestRecord = await db.vanRestockRequest.findUniqueOrThrow({
		where: { id: params.id },
		include: { requestedBy: true, warehouse: true },
	})
	if (requestRecord.status !== "READY") {
		throw redirect("/installer")
	}
	if (user.role === "INSTALLER" && requestRecord.requestedById !== user.id) {
		throw redirect("/installer")
	}
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	return { request: requestRecord, serviceCodes }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const requestRecord = await db.vanRestockRequest.findUniqueOrThrow({
		where: { id: params.id },
		include: { requestedBy: true },
	})
	if (requestRecord.status !== "READY") {
		throw redirect("/installer")
	}
	if (user.role === "INSTALLER" && requestRecord.requestedById !== user.id) {
		throw redirect("/installer")
	}

	const form = await request.formData()
	const signature = form.get("signature") as string

	if (!signature || signature === "data:,") {
		return { errorKey: "restock_pickup.errors.signature_required" }
	}

	const van = await db.van.findUnique({
		where: { installerId: requestRecord.requestedById },
	})
	const items =
		(requestRecord.items as {
			serviceCodeId: string
			preparedQty?: number
			qty?: number
		}[]) || []

	await db.$transaction(async (tx) => {
		await tx.vanRestockRequest.update({
			where: { id: params.id },
			data: {
				status: "FULFILLED",
				receiverSignature: signature,
				receiverSignedById: user.id,
				receiverSignedAt: new Date(),
			},
		})
		if (van) {
			for (const item of items) {
				const qty = item.preparedQty ?? item.qty ?? 0
				if (qty <= 0) continue
				await tx.vanInventoryTransaction.create({
					data: {
						vanId: van.id,
						serviceCodeId: item.serviceCodeId,
						qty,
						type: "RESTOCK",
						referenceId: params.id,
						createdById: user.id,
						note: `Restock pickup #${params.id.slice(-6)}`,
					},
				})
			}
		}
		await tx.notification.create({
			data: {
				userId: requestRecord.requestedById,
				message: `Your restock request #${params.id.slice(-6)} has been picked up.`,
			},
		})
	})

	throw redirect("/installer")
}

export default function PickupRestock({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { request: requestRecord, serviceCodes } = loaderData
	const { t } = useTranslation()
	const signatureRef = useRef<SignaturePadHandle>(null)
	const errorKey =
		actionData && "errorKey" in actionData
			? (actionData.errorKey as string)
			: null

	const items =
		(requestRecord.items as {
			serviceCodeId: string
			preparedQty?: number
			qty?: number
		}[]) || []

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const signature = signatureRef.current?.toDataURL()
		if (!signature || signature === "data:,") {
			alert(t("restock_pickup.errors.signature_required"))
			return
		}
		const formData = new FormData(e.currentTarget)
		formData.set("signature", signature)
		const form = e.currentTarget
		for (const [key, value] of formData.entries()) {
			const input = form.querySelector(
				`[name="${key}"]`,
			) as HTMLInputElement | null
			if (input && input.value !== value) input.value = value as string
		}
		form.submit()
	}

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">
				{t("restock_pickup.title", { id: requestRecord.id.slice(-6) })}
			</h1>
			<p className="text-sm text-slate-600">{requestRecord.warehouse?.name}</p>

			<div className="bg-white border rounded-lg p-4 space-y-2">
				<h2 className="text-sm font-medium text-slate-700">
					{t("restock_pickup.items_heading")}
				</h2>
				<ul className="text-sm space-y-1">
					{items.map(
						(item: {
							serviceCodeId: string
							qty?: number
							preparedQty?: number
						}) => {
							const code = serviceCodes.find(
								(c: { id: string }) => c.id === item.serviceCodeId,
							)
							const qty = item.preparedQty ?? item.qty ?? 0
							return (
								<li key={item.serviceCodeId}>
									{code?.claroCode ?? item.serviceCodeId} — {code?.name}: {qty}
								</li>
							)
						},
					)}
				</ul>
			</div>

			<Form method="post" onSubmit={handleSubmit} className="space-y-4">
				<div>
					<Label>{t("restock_pickup.signature_label")}</Label>
					<p className="text-xs text-slate-500 mb-2">
						{t("restock_pickup.signature_hint")}
					</p>
					<SignaturePad ref={signatureRef} width={320} height={120} />
					<button
						type="button"
						onClick={() => signatureRef.current?.clear()}
						className="text-xs text-slate-400 hover:text-slate-600 mt-1"
					>
						{t("restock_pickup.clear")}
					</button>
				</div>

				{errorKey && (
					<p className="text-sm text-red-600">{t(errorKey as never)}</p>
				)}

				<Button type="submit" className="w-full">
					{t("restock_pickup.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
