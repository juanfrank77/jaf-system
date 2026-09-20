import { Dialog } from "@base-ui/react/dialog"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "~/lib/utils"

const Drawer = Dialog.Root
const DrawerTrigger = Dialog.Trigger
const DrawerClose = Dialog.Close

function DrawerContent({
	className,
	children,
	title,
	description,
	closeLabel,
	footer,
	...props
}: React.ComponentProps<typeof Dialog.Popup> & {
	title: React.ReactNode
	description?: React.ReactNode
	closeLabel: string
	footer?: React.ReactNode
}) {
	return (
		<Dialog.Portal>
			<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
			<Dialog.Popup
				className={cn(
					"fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-border bg-card shadow-lg outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
					className,
				)}
				{...props}
			>
				<div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
					<div className="min-w-0">
						<Dialog.Title className="text-base leading-6 font-semibold text-foreground">
							{title}
						</Dialog.Title>
						{description && (
							<Dialog.Description className="mt-1 text-sm text-muted-foreground">
								{description}
							</Dialog.Description>
						)}
					</div>
					<Dialog.Close
						aria-label={closeLabel}
						className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					>
						<HugeiconsIcon
							icon={Cancel01Icon}
							strokeWidth={2}
							className="size-4"
						/>
					</Dialog.Close>
				</div>
				<div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
				{footer && (
					<div className="shrink-0 border-t border-border px-6 py-4">
						{footer}
					</div>
				)}
			</Dialog.Popup>
		</Dialog.Portal>
	)
}

export { Drawer, DrawerClose, DrawerContent, DrawerTrigger }
