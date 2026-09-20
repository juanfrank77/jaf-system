import { Toast } from "@base-ui/react/toast"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "~/lib/utils"

const Toaster = Toast.Provider
const useToastManager = Toast.useToastManager

function ToastViewport({ className }: { className?: string }) {
	const { toasts } = useToastManager()
	return (
		<Toast.Portal>
			<Toast.Viewport
				className={cn(
					"fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-96",
					className,
				)}
			>
				{toasts.map((toast) => (
					<Toast.Root
						key={toast.id}
						toast={toast}
						className={cn(
							"rounded-lg border border-border bg-card p-3 shadow-md transition-all duration-200 ease-out",
							"data-starting-style:translate-y-2 data-starting-style:opacity-0",
							"data-ending-style:opacity-0",
						)}
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								{toast.title && (
									<Toast.Title className="text-sm font-semibold text-foreground" />
								)}
								{toast.description && (
									<Toast.Description className="mt-0.5 text-sm text-muted-foreground" />
								)}
							</div>
							<Toast.Close
								aria-label="Dismiss"
								className="shrink-0 text-muted-foreground hover:text-foreground"
							>
								<HugeiconsIcon
									icon={Cancel01Icon}
									strokeWidth={2}
									className="size-4"
								/>
							</Toast.Close>
						</div>
					</Toast.Root>
				))}
			</Toast.Viewport>
		</Toast.Portal>
	)
}

export { Toaster, ToastViewport, useToastManager }
