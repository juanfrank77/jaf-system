import { Dialog } from "@base-ui/react/dialog"
import {
	Cancel01Icon,
	Download01Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { buttonVariants } from "~/components/ui/button"

const isImage = (name: string) => /\.(jpe?g|png)$/i.test(name)

/**
 * The one download button: an outline button with the ⬇ icon that saves the
 * file under its friendly name. Icon only where there are many in a list
 * (Packet → Claro); with a `label` where a single file stands alone.
 */
export function DownloadIconLink({
	href,
	name,
	label,
}: {
	href: string
	name: string
	label?: string
}) {
	const { t } = useTranslation()
	return (
		<a
			href={href}
			download={name}
			aria-label={label ? undefined : `${t("packet.file_download")} ${name}`}
			className={buttonVariants({
				variant: "outline",
				size: label ? "default" : "icon",
			})}
		>
			<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
			{label}
		</a>
	)
}

/**
 * 👁 icon button: opens the file in a pop-up on top of the page, so it can be
 * checked without downloading it. Photos show inline; a PDF shows in a frame
 * (a phone may only draw its first page there), so "Open in new tab" is
 * always offered.
 */
export function FileViewerButton({
	href,
	name,
}: {
	href: string
	name: string
}) {
	const { t } = useTranslation()
	return (
		<Dialog.Root>
			<Dialog.Trigger
				aria-label={`${t("packet.file_view")} ${name}`}
				className={buttonVariants({ variant: "outline", size: "icon" })}
			>
				<HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60" />
				<Dialog.Popup
					aria-label={name}
					className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl bg-card shadow-xl outline-none md:inset-10"
				>
					<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
						<Dialog.Title className="min-w-0 truncate text-sm font-semibold">
							{name}
						</Dialog.Title>
						<div className="flex shrink-0 items-center gap-2">
							<a
								href={href}
								target="_blank"
								rel="noreferrer"
								className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
							>
								{t("packet.file_open_tab")}
							</a>
							<Dialog.Close
								aria-label={t("packet.file_close")}
								className={buttonVariants({ variant: "ghost", size: "icon" })}
							>
								<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
							</Dialog.Close>
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-auto bg-muted/40">
						{isImage(name) ? (
							<img
								src={href}
								alt={name}
								className="mx-auto h-full max-h-full w-auto max-w-full object-contain"
							/>
						) : (
							<iframe src={href} title={name} className="h-full w-full" />
						)}
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
