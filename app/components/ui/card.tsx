import { cn } from "~/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-card shadow-sm",
				className,
			)}
			{...props}
		/>
	)
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-semibold",
				className,
			)}
			{...props}
		/>
	)
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-content" className={cn("p-4", className)} {...props} />
	)
}

export { Card, CardContent, CardHeader }
