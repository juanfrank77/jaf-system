import { cn } from "~/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"overflow-hidden rounded-lg border border-border bg-card",
				className,
			)}
			{...props}
		/>
	)
}

function CardHeader({
	className,
	divider = false,
	...props
}: React.ComponentProps<"div"> & { divider?: boolean }) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"flex items-start justify-between gap-3 px-6 py-4",
				divider && "border-b border-border",
				className,
			)}
			{...props}
		/>
	)
}

function CardHeaderText({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header-text"
			className={cn("min-w-0", className)}
			{...props}
		/>
	)
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return (
		<h3
			data-slot="card-title"
			className={cn(
				"text-base leading-6 font-semibold text-foreground",
				className,
			)}
			{...props}
		/>
	)
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="card-description"
			className={cn("mt-0.5 text-sm text-muted-foreground", className)}
			{...props}
		/>
	)
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("px-6 py-4", className)}
			{...props}
		/>
	)
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn(
				"flex items-center gap-2 border-t border-border px-6 py-4",
				className,
			)}
			{...props}
		/>
	)
}

export {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardHeaderText,
	CardTitle,
}
