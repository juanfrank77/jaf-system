import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
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
	return { user, van, completion }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user, van } = await requireInstaller(request)
	const form = await request.formData()
	const newClaroOrderNo = (form.get("newClaroOrderNo") as string)?.trim()
	const res = await submitSwap(
		{
			completionId: params.completionId as string,
			serialOut: form.get("serialOut") as string,
			reason: form.get("reason") as SwapReason,
			serialIn: form.get("serialIn") as string,
			newClaroOrderNo: newClaroOrderNo ? newClaroOrderNo : undefined,
			installerId: user.id,
			vanId: van?.id ?? "",
		},
		{ id: user.id },
	)

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
					message: `Warranty swap submitted (${res.swapId}).`,
				},
			}),
		),
	)

	return redirect("/installer")
}

export default function SwapOutIn({ loaderData }: Route.ComponentProps) {
	const { completion } = loaderData
	const { t } = useTranslation()
	const [scanningOut, setScanningOut] = useState(false)
	const [scanningIn, setScanningIn] = useState(false)
	const [serialOut, setSerialOut] = useState("")
	const [serialIn, setSerialIn] = useState("")

	return (
		<div className="space-y-6 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("installer.swap.heading", "Warranty Swap")}
			</h1>
			<p className="text-sm text-muted-foreground">
				{completion.claroOrderNo} — {completion.address}
			</p>

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
							<span className="text-sm">{serialOut || "—"}</span>
							<Button
								type="button"
								variant="outline"
								onClick={() => setScanningOut(true)}
							>
								{t("installer.completion.scan", "Scan")}
							</Button>
						</div>
					)}
				</div>

				<div className="space-y-1">
					<Label htmlFor="reason">{t("installer.swap.reason", "Reason")}</Label>
					<Select name="reason" defaultValue="HARDWARE">
						<SelectTrigger id="reason">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{REASONS.map((r) => (
								<SelectItem key={r} value={r}>
									{r}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

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
							<span className="text-sm">{serialIn || "—"}</span>
							<Button
								type="button"
								variant="outline"
								onClick={() => setScanningIn(true)}
							>
								{t("installer.completion.scan", "Scan")}
							</Button>
						</div>
					)}
				</div>

				<div className="space-y-1">
					<Label htmlFor="newClaroOrderNo">
						{t("installer.swap.new_order_no", "New order # (blank = callback)")}
					</Label>
					<Input id="newClaroOrderNo" name="newClaroOrderNo" />
				</div>

				<Button type="submit">{t("installer.swap.submit", "Submit")}</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
