import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerLoopRail } from "~/components/installer-loop-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { db } from "~/lib/db.server"
import { requireInstaller } from "~/lib/installer-context.server"
import { refuse } from "~/lib/offline-validation.server"
import { submitSwap } from "~/lib/swap-submit.server"
import type { SwapReason } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.installer.swap.$completionId"

export const meta: Route.MetaFunction = () => [
	{ title: "Warranty Swap — JAF Ops" },
]

const REASONS: SwapReason[] = [
	"HARDWARE",
	"INSTALL_DEFECT",
	"CUSTOMER",
	"LINE",
	"OTHER",
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user, van } = await requireInstaller(request)
	const completion = await db.installCompletion.findFirstOrThrow({
		where: { id: params.completionId, installerId: user.id },
	})
	// The serials this van carries, so the form can warn (not block) when the
	// unit going in is not one of them.
	const vanSerialRows = van
		? await db.serialLocation.findMany({
				where: { status: "VAN", currentRef: van.id },
				select: { serial: true },
			})
		: []
	return {
		user,
		van,
		completion,
		vanSerials: vanSerialRows.map((r) => r.serial),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user, van } = await requireInstaller(request)
	const form = await request.formData()
	const serialOut = ((form.get("serialOut") as string | null) ?? "").trim()
	const serialIn = ((form.get("serialIn") as string | null) ?? "").trim()
	const reason = form.get("reason") as string | null
	const newClaroOrderNo = (form.get("newClaroOrderNo") as string | null)?.trim()

	if (!van?.active)
		return refuse(request, {
			errorKey: "installer.swap.errors.no_van" as const,
		})
	const completion = await db.installCompletion.findFirst({
		where: { id: params.completionId, installerId: user.id },
		select: { id: true },
	})
	if (!completion)
		return refuse(request, {
			errorKey: "installer.swap.errors.completion_not_found" as const,
		})
	if (!serialOut)
		return refuse(request, {
			errorKey: "installer.swap.errors.serial_out_required" as const,
		})
	if (!serialIn)
		return refuse(request, {
			errorKey: "installer.swap.errors.serial_in_required" as const,
		})
	if (serialOut === serialIn)
		return refuse(request, {
			errorKey: "installer.swap.errors.serials_identical" as const,
		})
	if (!REASONS.includes(reason as SwapReason))
		return refuse(request, {
			errorKey: "installer.swap.errors.reason_required" as const,
		})

	let swapId: string
	try {
		const res = await submitSwap(
			{
				completionId: params.completionId as string,
				serialOut,
				reason: reason as SwapReason,
				serialIn,
				newClaroOrderNo: newClaroOrderNo ? newClaroOrderNo : undefined,
				installerId: user.id,
				vanId: van.id,
			},
			{ id: user.id },
		)
		swapId = res.swapId
	} catch {
		return refuse(request, {
			errorKey: "installer.swap.errors.swap_failed" as const,
		})
	}

	// The swap is already recorded; a notification failure must not turn it
	// into an error the installer would retry.
	try {
		const notifyRoles = await db.user.findMany({
			where: {
				role: { in: ["INSTALLER_SUPERVISOR", "WAREHOUSE"] },
				active: true,
			},
			select: { id: true },
		})
		await db.$transaction(
			notifyRoles.map((r) =>
				db.notification.create({
					data: {
						userId: r.id,
						message: `Warranty swap submitted (${swapId}).`,
					},
				}),
			),
		)
	} catch {
		/* best effort */
	}

	return redirect("/installer?swapped=1")
}

export default function SwapOutIn({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { completion, vanSerials } = loaderData
	const { t } = useTranslation()
	const [reason, setReason] = useState<SwapReason>("HARDWARE")
	const [scanningOut, setScanningOut] = useState(false)
	const [scanningIn, setScanningIn] = useState(false)
	const [serialOut, setSerialOut] = useState("")
	const [serialIn, setSerialIn] = useState("")

	return (
		<div className="space-y-6 max-w-xl">
			<InstallerLoopRail current="SWAP" />
			<Callout title={t("installer.installer_flow.callout.swap_title")}>
				{t("installer.installer_flow.callout.swap_body")}
			</Callout>
			<h1 className="text-xl font-semibold">
				{t("installer.swap.heading", "Warranty Swap")}
			</h1>
			<p className="text-sm text-muted-foreground">
				{completion.claroOrderNo} — {completion.address}
			</p>

			{actionData && "errorKey" in actionData && actionData.errorKey && (
				<div role="alert">
					<Callout tone="danger" title={t("installer.swap.errors.title")}>
						{t(actionData.errorKey)}
					</Callout>
				</div>
			)}

			<Form method="post" className="space-y-4">
				<input type="hidden" name="serialOut" value={serialOut} />
				<input type="hidden" name="serialIn" value={serialIn} />

				<div className="space-y-2">
					<Label>{t("installer.swap.scan_out", "Scan serial out")}</Label>
					{scanningOut ? (
						<BarcodeScanner
							onDecode={(text) => {
								setSerialOut(text)
								setScanningOut(false)
							}}
							onGiveUp={() => setScanningOut(false)}
						/>
					) : (
						<div className="flex items-center gap-2">
							<span className="font-mono text-sm">{serialOut || "—"}</span>
							<Button
								type="button"
								variant="outline"
								size="lg"
								className="h-11 text-base"
								onClick={() => setScanningOut(true)}
							>
								{t("installer.completion.scan", "Scan")}
							</Button>
						</div>
					)}
				</div>

				<div className="space-y-1">
					<Label htmlFor="reason">{t("installer.swap.reason", "Reason")}</Label>
					<Select
						name="reason"
						value={reason}
						onValueChange={(v) => v && setReason(v as SwapReason)}
						items={REASONS.map((r) => ({
							value: r,
							label: t(`installer.swap.reasons.${r}`),
						}))}
					>
						<SelectTrigger
							id="reason"
							aria-label={t("installer.swap.reason", "Reason")}
							className="h-11 w-full text-base"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{REASONS.map((r) => (
								<SelectItem key={r} value={r}>
									{t(`installer.swap.reasons.${r}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{serialOut !== "" &&
					completion.serialInstalled &&
					serialOut !== completion.serialInstalled && (
						<Callout tone="warn" title={t("installer.swap.out_mismatch_title")}>
							{t("installer.swap.out_mismatch_body", {
								recorded: completion.serialInstalled,
							})}
						</Callout>
					)}

				<div className="space-y-2">
					<Label>{t("installer.swap.scan_in", "Scan serial in")}</Label>
					{scanningIn ? (
						<BarcodeScanner
							onDecode={(text) => {
								setSerialIn(text)
								setScanningIn(false)
							}}
							onGiveUp={() => setScanningIn(false)}
						/>
					) : (
						<div className="flex items-center gap-2">
							<span className="font-mono text-sm">{serialIn || "—"}</span>
							<Button
								type="button"
								variant="outline"
								size="lg"
								className="h-11 text-base"
								onClick={() => setScanningIn(true)}
							>
								{t("installer.completion.scan", "Scan")}
							</Button>
						</div>
					)}
				</div>

				{serialIn !== "" && !vanSerials.includes(serialIn) && (
					<Callout tone="warn" title={t("installer.swap.in_not_on_van_title")}>
						{t("installer.swap.in_not_on_van_body")}
					</Callout>
				)}

				<div className="space-y-1">
					<Label htmlFor="newClaroOrderNo">
						{t("installer.swap.new_order_no", "New order # (blank = callback)")}
					</Label>
					<Input
						id="newClaroOrderNo"
						name="newClaroOrderNo"
						className="h-11 text-base"
					/>
				</div>

				<Button type="submit" size="lg" className="h-12 w-full text-base">
					{t("installer.swap.submit", "Submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
