import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import type { PacketMode } from "~/lib/packet-url"
import { packetUrl, viewerFrameUrl } from "~/lib/packet-url"
import type { JournalOutline } from "~/lib/pdf/production-journal.server"

const ZOOMS = [75, 100, 125, 150]

/** Print a PDF without leaving the page: load it in a hidden frame, then print the frame. */
export function printPdf(url: string) {
	const frame = document.createElement("iframe")
	frame.style.cssText =
		"position:fixed;right:0;bottom:0;width:0;height:0;border:0"
	frame.onload = () => {
		frame.contentWindow?.focus()
		frame.contentWindow?.print()
		// Leave it long enough for the print dialog to read the document.
		setTimeout(() => frame.remove(), 60_000)
	}
	frame.src = url
	document.body.appendChild(frame)
}

function useOutline(runId: string, open: boolean) {
	const fetcher = useFetcher<JournalOutline>()
	// biome-ignore lint/correctness/useExhaustiveDependencies: load once per open; the fetcher object changes identity every state change
	useEffect(() => {
		if (open && fetcher.state === "idle" && !fetcher.data)
			fetcher.load(`/finance/payroll/${runId}/journal/outline`)
	}, [open, runId])
	return fetcher.data
}

function ViewerDialog({
	runId,
	label,
	open,
	onOpenChange,
}: {
	runId: string
	label: string
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()
	const outline = useOutline(runId, open)
	const [page, setPage] = useState(1)
	const [zoom, setZoom] = useState(100)
	const total = outline?.totalPages ?? 1
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<Dialog.Popup
					aria-label={t("comptroller_payroll.viewer_title", { label })}
					className="fixed inset-4 z-50 flex flex-col rounded-lg border bg-card shadow-xl outline-none md:inset-10"
				>
					<div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
						<Dialog.Title className="font-semibold">
							{t("comptroller_payroll.viewer_title", { label })}
						</Dialog.Title>
						<div className="flex-1" />
						<label className="flex items-center gap-1">
							<span className="sr-only">
								{t("comptroller_payroll.jump_to")}
							</span>
							<select
								aria-label={t("comptroller_payroll.jump_to")}
								className="rounded border bg-background px-2 py-1"
								value=""
								onChange={(e) => {
									const n = Number(e.target.value)
									if (n) setPage(n)
								}}
							>
								<option value="">{t("comptroller_payroll.jump_to")}</option>
								{outline?.brigades.map((b) => (
									<option key={b.code} value={b.startPage}>
										{b.code} {b.label} · p.{b.startPage}
									</option>
								))}
							</select>
						</label>
						<select
							aria-label={t("comptroller_payroll.zoom")}
							className="rounded border bg-background px-2 py-1"
							value={zoom}
							onChange={(e) => setZoom(Number(e.target.value))}
						>
							{ZOOMS.map((z) => (
								<option key={z} value={z}>
									{z}%
								</option>
							))}
						</select>
						<Dialog.Close
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("comptroller_payroll.close")}
						</Dialog.Close>
					</div>
					<div className="min-h-0 flex-1 bg-muted">
						{open && (
							<iframe
								key={`${page}-${zoom}`}
								title={t("comptroller_payroll.viewer_title", { label })}
								src={viewerFrameUrl(runId, page, zoom)}
								className="size-full"
							/>
						)}
					</div>
					<div className="flex items-center justify-center gap-3 border-t px-4 py-2 text-sm">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={page <= 1}
							onClick={() => setPage((p) => Math.max(1, p - 1))}
						>
							‹ {t("comptroller_payroll.prev_page")}
						</Button>
						<span>{t("comptroller_payroll.page_of", { page, total })}</span>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={page >= total}
							onClick={() => setPage((p) => Math.min(total, p + 1))}
						>
							{t("comptroller_payroll.next_page")} ›
						</Button>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

type Choice = "whole" | "brigades" | "summary"

function PrintDialog({
	runId,
	open,
	onOpenChange,
}: {
	runId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()
	const outline = useOutline(runId, open)
	const [choice, setChoice] = useState<Choice>("whole")
	const [picked, setPicked] = useState<string[]>([])
	const target: PacketMode | null =
		choice === "brigades"
			? picked.length > 0
				? { mode: "brigades", brigades: picked }
				: null
			: { mode: choice }
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-lg border bg-card p-5 shadow-xl outline-none">
					<Dialog.Title className="font-semibold">
						{t("comptroller_payroll.print_dialog_title")}
					</Dialog.Title>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							name="packet-choice"
							checked={choice === "whole"}
							onChange={() => setChoice("whole")}
						/>
						{t("comptroller_payroll.print_whole", {
							count: outline?.totalPages ?? 0,
						})}
					</label>
					<div className="space-y-1">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="packet-choice"
								checked={choice === "brigades"}
								onChange={() => setChoice("brigades")}
							/>
							{t("comptroller_payroll.print_selected")}
						</label>
						{choice === "brigades" && (
							<ul className="ml-6 max-h-52 space-y-1 overflow-y-auto text-sm">
								{outline?.brigades.map((b) => (
									<li key={b.code}>
										<label className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={picked.includes(b.code)}
												onChange={(e) =>
													setPicked((p) =>
														e.target.checked
															? [...p, b.code]
															: p.filter((c) => c !== b.code),
													)
												}
											/>
											{b.code} {b.label} (p. {b.startPage})
										</label>
									</li>
								))}
							</ul>
						)}
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							name="packet-choice"
							checked={choice === "summary"}
							onChange={() => setChoice("summary")}
						/>
						{t("comptroller_payroll.print_summary")}
					</label>
					<div className="flex items-center justify-end gap-2 pt-2">
						<Dialog.Close
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							{t("comptroller_payroll.close")}
						</Dialog.Close>
						<a
							href={target ? packetUrl(runId, target) : undefined}
							aria-disabled={!target}
							download
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("comptroller_payroll.download_go")}
						</a>
						<Button
							type="button"
							size="sm"
							disabled={!target}
							onClick={() => {
								if (!target) return
								printPdf(packetUrl(runId, target, { inline: true }))
								onOpenChange(false)
							}}
						>
							{t("comptroller_payroll.print_go")}
						</Button>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

/** View / Print / Download for a sent request's packet (Carmen's copy). */
export function PacketActions({
	runId,
	label,
}: {
	runId: string
	label: string
}) {
	const { t } = useTranslation()
	const [viewing, setViewing] = useState(false)
	const [printing, setPrinting] = useState(false)
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				type="button"
				variant="secondary"
				onClick={() => setViewing(true)}
			>
				{t("comptroller_payroll.view_packet")}
			</Button>
			<Button
				type="button"
				variant="secondary"
				onClick={() => setPrinting(true)}
			>
				{t("comptroller_payroll.print_packet")}
			</Button>
			<ViewerDialog
				runId={runId}
				label={label}
				open={viewing}
				onOpenChange={setViewing}
			/>
			<PrintDialog runId={runId} open={printing} onOpenChange={setPrinting} />
		</div>
	)
}

/** Print one brigade's pages straight from its row. */
export function PrintBrigadeButton({
	runId,
	brigadeCodes,
}: {
	runId: string
	brigadeCodes: string[]
}) {
	const { t } = useTranslation()
	return (
		<Button
			type="button"
			size="xs"
			variant="outline"
			onClick={() =>
				printPdf(
					packetUrl(
						runId,
						{ mode: "brigades", brigades: brigadeCodes },
						{ inline: true },
					),
				)
			}
		>
			{t("comptroller_payroll.print_row")}
		</Button>
	)
}
