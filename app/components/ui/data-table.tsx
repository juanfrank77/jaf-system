import { Card } from "~/components/ui/card"
import { cn } from "~/lib/utils"

// The warehouse reference tables (serial register, movement log, material
// requests) share this look: a card, a muted header row, divided body rows.
function DataTable({
	className,
	children,
}: {
	className?: string
	children: React.ReactNode
}) {
	return (
		<Card data-slot="data-table" className={className}>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">{children}</table>
			</div>
		</Card>
	)
}

function DataTableHead({ children }: { children: React.ReactNode }) {
	return (
		<thead>
			<tr className="text-xs font-medium text-muted-foreground">{children}</tr>
		</thead>
	)
}

function Th({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			scope="col"
			className={cn("px-4 py-3 font-medium whitespace-nowrap", className)}
			{...props}
		/>
	)
}

function Td({ className, ...props }: React.ComponentProps<"td">) {
	return <td className={cn("px-4 py-3 align-middle", className)} {...props} />
}

function Tr({ className, ...props }: React.ComponentProps<"tr">) {
	return <tr className={cn("border-t border-border", className)} {...props} />
}

export { DataTable, DataTableHead, Td, Th, Tr }
