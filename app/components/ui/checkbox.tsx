import { cn } from "~/lib/utils"

function Checkbox({
	className,
	checked,
	onCheckedChange,
	...props
}: React.ComponentProps<"input"> & {
	checked?: boolean
	onCheckedChange?: (checked: boolean) => void
	className?: string
}) {
	return (
		<input
			type="checkbox"
			data-slot="checkbox"
			checked={checked}
			onChange={(e) => onCheckedChange?.(e.target.checked)}
			className={cn(
				"size-4 shrink-0 rounded-[4px] border border-input shadow-sm transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive accent-primary",
				className,
			)}
			{...props}
		/>
	)
}

export { Checkbox }
