import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { releaseRestockToVan } from "~/lib/load-to-van.server"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.restock.$id_.release"

export const meta: Route.MetaFunction = () => [
	{ title: "Release Restock — JAF Ops" },
]

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const restock = await db.restockRequest.findUniqueOrThrow({
		where: { id: params.id },
		include: { van: true },
	})
	const lines = restock.lines as { serviceCodeId: string; qty: number }[]
	const codes = await db.serviceCode.findMany({
		where: { id: { in: lines.map((l) => l.serviceCodeId) } },
	})
	const codesById = Object.fromEntries(codes.map((c) => [c.id, c]))
	return { restock, lines, codesById }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, rolesMatching(canReleaseToVan))
	const form = await request.formData()
	const releaseSignature = form.get("releaseSignature") as string
	const receiveSignature = form.get("receiveSignature") as string
	if (!releaseSignature || !receiveSignature) {
		return { errorKey: "restock_release.errors.signatures_required" as const }
	}
	const serials = JSON.parse((form.get("serials") as string) || "[]")
	const accessories = JSON.parse((form.get("accessories") as string) || "[]")
	await releaseRestockToVan(params.id as string, serials, accessories, {
		id: user.id,
	})
	return redirect("/admin/vans")
}

export default function RestockRelease({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { restock, lines, codesById } = loaderData
	const { t } = useTranslation()
	const releaseSigRef = useRef<SignaturePadHandle>(null)
	const receiveSigRef = useRef<SignaturePadHandle>(null)

	const serialInputIds = useMemo(
		() =>
			Object.fromEntries(
				lines.map((l) => [
					l.serviceCodeId,
					Array.from({ length: l.qty }, () => crypto.randomUUID()),
				]),
			),
		[lines],
	)

	const serializedLines = useMemo(
		() => lines.filter((l) => codesById[l.serviceCodeId]?.serialized),
		[lines, codesById],
	)
	const bulkLines = useMemo(
		() => lines.filter((l) => !codesById[l.serviceCodeId]?.serialized),
		[lines, codesById],
	)

	const [serialInputs, setSerialInputs] = useState<Record<string, string[]>>({})

	function setSerialAt(serviceCodeId: string, index: number, value: string) {
		setSerialInputs((prev) => {
			const arr = [...(prev[serviceCodeId] ?? [])]
			arr[index] = value
			return { ...prev, [serviceCodeId]: arr }
		})
	}

	const serials = serializedLines
		.flatMap((l) =>
			Array.from({ length: l.qty }, (_, i) => ({
				serial: serialInputs[l.serviceCodeId]?.[i] ?? "",
				serviceCodeId: l.serviceCodeId,
			})),
		)
		.filter((s) => s.serial)

	return (
		<div className="space-y-6 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("restock_release.heading", "Release Restock to Van")}
			</h1>
			<p className="text-sm text-muted-foreground">{restock.van.name}</p>
			{actionData && "errorKey" in actionData && (
				<p className="text-sm text-status-danger">
					{t(
						actionData.errorKey,
						"Both signatures are required before releasing.",
					)}
				</p>
			)}

			<Form
				method="post"
				className="space-y-4"
				onSubmit={() => {
					const releaseField = document.querySelector<HTMLInputElement>(
						'input[name="releaseSignature"]',
					)
					if (releaseField && releaseSigRef.current)
						releaseField.value = releaseSigRef.current.isEmpty()
							? ""
							: releaseSigRef.current.toDataURL()
					const receiveField = document.querySelector<HTMLInputElement>(
						'input[name="receiveSignature"]',
					)
					if (receiveField && receiveSigRef.current)
						receiveField.value = receiveSigRef.current.isEmpty()
							? ""
							: receiveSigRef.current.toDataURL()
				}}
			>
				<input type="hidden" name="serials" value={JSON.stringify(serials)} />
				<input
					type="hidden"
					name="accessories"
					value={JSON.stringify(bulkLines)}
				/>
				<input type="hidden" name="releaseSignature" />
				<input type="hidden" name="receiveSignature" />

				{serializedLines.map((l) => (
					<div key={l.serviceCodeId} className="space-y-1">
						<Label>
							{codesById[l.serviceCodeId]?.claroCode} — {l.qty}{" "}
							{t("restock_release.serials", "serial(s)")}
						</Label>
						{Array.from({ length: l.qty }, (_, i) => (
							<Input
								key={serialInputIds[l.serviceCodeId][i]}
								placeholder={t(
									"restock_release.scan_serial",
									"Scan/enter serial",
								)}
								onChange={(e) =>
									setSerialAt(l.serviceCodeId, i, e.target.value)
								}
							/>
						))}
					</div>
				))}

				{bulkLines.map((l) => (
					<p key={l.serviceCodeId} className="text-sm">
						{codesById[l.serviceCodeId]?.claroCode ?? l.serviceCodeId}: {l.qty}
					</p>
				))}

				<div className="space-y-1">
					<Label>
						{t(
							"restock_release.warehouse_signature",
							"Warehouse release signature",
						)}
					</Label>
					<SignaturePad ref={releaseSigRef} />
				</div>
				<div className="space-y-1">
					<Label>
						{t("restock_release.van_signature", "Van receipt signature")}
					</Label>
					<SignaturePad ref={receiveSigRef} />
				</div>
				<Button type="submit">{t("restock_release.submit", "Release")}</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
