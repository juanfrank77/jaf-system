import type * as React from "react"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
	return (
		<div className="w-full overflow-x-auto">
			<table
				data-slot="table"
				className={cn("w-full caption-bottom text-sm", className)}
				{...props}
			/>
		</div>
	)
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			data-slot="table-header"
			className={cn("sticky top-0 z-10 bg-muted", className)}
			{...props}
		/>
	)
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			data-slot="table-body"
			className={cn("divide-y divide-border", className)}
			{...props}
		/>
	)
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				"h-11 transition-colors hover:bg-muted/50 data-inactive:opacity-60",
				className,
			)}
			{...props}
		/>
	)
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			data-slot="table-head"
			scope="col"
			className={cn(
				"px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase",
				className,
			)}
			{...props}
		/>
	)
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			data-slot="table-cell"
			className={cn("px-3 py-2 align-middle text-foreground", className)}
			{...props}
		/>
	)
}

function TableEmptyRow({
	colSpan,
	children,
}: {
	colSpan: number
	children: React.ReactNode
}) {
	return (
		<tr>
			<td colSpan={colSpan} className="p-0">
				{children}
			</td>
		</tr>
	)
}

function TableToolbar({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="table-toolbar"
			className={cn(
				"flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between",
				className,
			)}
			{...props}
		/>
	)
}

function TableFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="table-footer"
			className={cn(
				"flex flex-col gap-3 border-t border-border p-3 sm:flex-row sm:items-center sm:justify-between",
				className,
			)}
			{...props}
		/>
	)
}

function TablePagination({
	page,
	pageCount,
	onPageChange,
	labelPrev,
	labelNext,
	summary,
}: {
	page: number
	pageCount: number
	onPageChange: (page: number) => void
	labelPrev: string
	labelNext: string
	summary?: React.ReactNode
}) {
	return (
		<div className="flex items-center gap-3">
			{summary && (
				<span className="text-xs text-muted-foreground">{summary}</span>
			)}
			<div className="flex items-center gap-1.5">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
				>
					{labelPrev}
				</Button>
				<span className="px-1 text-xs tabular-nums text-muted-foreground">
					{page} / {pageCount}
				</span>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={page >= pageCount}
					onClick={() => onPageChange(page + 1)}
				>
					{labelNext}
				</Button>
			</div>
		</div>
	)
}

export {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableFooter,
	TableHead,
	TableHeader,
	TablePagination,
	TableRow,
	TableToolbar,
}
