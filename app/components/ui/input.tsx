import { cn } from "~/lib/utils"

function Input({
	className,
	type,
	leading,
	trailing,
	...props
}: React.ComponentProps<"input"> & {
	leading?: React.ReactNode
	trailing?: React.ReactNode
}) {
	const input = (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
				leading && "pl-7",
				trailing && "pr-10",
				className,
			)}
			{...props}
		/>
	)

	if (!leading && !trailing) return input

	return (
		<div className="relative flex items-center">
			{leading && (
				<span className="pointer-events-none absolute left-3 text-sm text-muted-foreground">
					{leading}
				</span>
			)}
			{input}
			{trailing && (
				<span className="pointer-events-none absolute right-3 text-sm text-muted-foreground">
					{trailing}
				</span>
			)}
		</div>
	)
}

function InputError({ children }: { children: React.ReactNode }) {
	return (
		<p role="alert" className="mt-1 text-xs text-status-danger">
			{children}
		</p>
	)
}

export { Input, InputError }
