import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { buttonVariants } from "~/components/ui/button"

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/**
 * A button that opens a stored file (a photo or a PDF) in a read-only pop-up
 * over the current screen. Nothing prints or downloads; Close or Esc returns to
 * the same spot. The PDF page stays white in dark mode on purpose: it is paper.
 */
export function FileViewerLink({
	href,
	label,
	title,
}: {
	href: string
	label: string
	title: string
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Trigger
				className={buttonVariants({ variant: "outline", size: "xs" })}
			>
				{label}
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
				<Dialog.Popup
					aria-label={title}
					className="fixed inset-4 z-50 flex flex-col rounded-lg border bg-card shadow-xl outline-none md:inset-10"
				>
					<div className="flex items-center gap-3 border-b px-4 py-2 text-sm">
						<Dialog.Title className="font-semibold">{title}</Dialog.Title>
						<div className="flex-1" />
						<Dialog.Close
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("installers.warranty.close")}
						</Dialog.Close>
					</div>
					<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted">
						{open &&
							(IMAGE.test(href.split("?")[0]) ? (
								<img
									src={href}
									alt={title}
									className="max-h-full max-w-full object-contain"
								/>
							) : (
								<iframe title={title} src={href} className="size-full" />
							))}
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
