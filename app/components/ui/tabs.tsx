import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "~/lib/utils"

const Tabs = TabsPrimitive.Root

function TabsList({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(
				"inline-flex items-center gap-4 border-b border-border",
				className,
			)}
			{...props}
		/>
	)
}

function TabsTab({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-tab"
			className={cn(
				"relative flex items-center gap-1.5 rounded-t-md px-1 py-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-active:text-foreground data-active:after:absolute data-active:after:inset-x-0 data-active:after:-bottom-px data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-primary",
				className,
			)}
			{...props}
		/>
	)
}

function TabsPanel({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-panel"
			className={cn("pt-4 outline-none", className)}
			{...props}
		/>
	)
}

export { Tabs, TabsList, TabsPanel, TabsTab }
