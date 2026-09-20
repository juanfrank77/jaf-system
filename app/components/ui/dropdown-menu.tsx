import { Menu } from "@base-ui/react/menu"
import { cn } from "~/lib/utils"

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger

function DropdownMenuContent({
	className,
	children,
	side = "bottom",
	align = "end",
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof Menu.Popup> &
	Pick<
		React.ComponentProps<typeof Menu.Positioner>,
		"side" | "align" | "sideOffset"
	>) {
	return (
		<Menu.Portal>
			<Menu.Positioner
				side={side}
				align={align}
				sideOffset={sideOffset}
				className="z-50"
			>
				<Menu.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						"min-w-40 origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	)
}

function DropdownMenuItem({
	className,
	variant = "default",
	...props
}: React.ComponentProps<typeof Menu.Item> & {
	variant?: "default" | "destructive"
}) {
	return (
		<Menu.Item
			data-slot="dropdown-menu-item"
			className={cn(
				"flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
				variant === "destructive" &&
					"text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive",
				className,
			)}
			{...props}
		/>
	)
}

function DropdownMenuSeparator({ className }: { className?: string }) {
	return (
		<div
			data-slot="dropdown-menu-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
		/>
	)
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
}
