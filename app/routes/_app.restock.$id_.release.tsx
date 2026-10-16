import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { db } from "~/lib/db.server"
import { releaseRestockToVan } from "~/lib/load-to-van.server"
import { pageTitle } from "~/lib/page-title"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.restock.$id_.release"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.release_restock") },
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
	const { t, i18n } = useTranslation()
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

	const totalUnits = lines.reduce((sum, l) => sum + l.qty, 0)

	return (
		<div className="max-w-3xl space-y-6">
			<PageHeader
				title={t("restock_release.heading", "Release Restock to Van")}
				description={
					<>
						<span className="font-medium text-foreground">
							{restock.van.name}
						</span>
						{" · "}
						<span className="font-mono">#{restock.id.slice(-6)}</span>
						{" · "}
						{new Date(restock.submittedAt).toLocaleDateString(i18n.language)}
					</>
				}
			/>
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
				className="space-y-6"
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

				<section className="space-y-2">
					<h2 className="text-sm font-semibold">
						{t("restock_release.materials_title", "1. Materials to load")}
					</h2>
					<Card>
						<ul className="divide-y divide-border">
							{lines.map((l) => {
								const code = codesById[l.serviceCodeId]
								const isSerialized = !!code?.serialized
								return (
									<li key={l.serviceCodeId} className="space-y-2 px-4 py-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="text-sm font-medium">
													{code?.canonicalName ??
														code?.name ??
														t(
															"restock_release.unknown_material",
															"Unknown material",
														)}
												</p>
												<p className="font-mono text-xs text-muted-foreground">
													{code?.claroCode ?? l.serviceCodeId}
												</p>
											</div>
											<Badge variant={isSerialized ? "info" : "neutral"}>
												× {l.qty}
												{code?.unit ? ` ${code.unit}` : ""}
											</Badge>
										</div>
										{isSerialized && (
											<div className="space-y-1.5">
												<Label className="text-xs text-muted-foreground">
													{t(
														"restock_release.serials_hint",
														"Scan or enter one serial per unit",
													)}
												</Label>
												<div className="grid gap-2 sm:grid-cols-2">
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
											</div>
										)}
									</li>
								)
							})}
						</ul>
					</Card>
					<p className="text-xs text-muted-foreground">
						{t("restock_release.total", {
							materials: lines.length,
							units: totalUnits,
							defaultValue: "{{materials}} materials · {{units}} units",
						})}
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-sm font-semibold">
						{t("restock_release.signatures_title", "2. Signatures")}
					</h2>
					<div className="grid gap-4 sm:grid-cols-2">
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
					</div>
				</section>

				<Button type="submit">{t("restock_release.submit", "Release")}</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
