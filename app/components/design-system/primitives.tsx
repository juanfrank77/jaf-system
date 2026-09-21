import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Link } from "react-router"
import { cn } from "~/lib/utils"

export function DesignSystem({
	children,
	className,
	constrain,
}: {
	children: ReactNode
	className?: string
	/** Guide content column (1200px) for ported screens inside a wide shell. */
	constrain?: boolean
}) {
	return (
		<div className={cn("jaf-ds", constrain && "jaf-constrain", className)}>
			{children}
		</div>
	)
}

export function Greet({
	title,
	subtitle,
	actions,
}: {
	title: ReactNode
	subtitle?: ReactNode
	actions?: ReactNode
}) {
	return (
		<div className="jaf-greet">
			<div>
				<h1>{title}</h1>
				{subtitle ? <p>{subtitle}</p> : null}
			</div>
			{actions ? <div className="jaf-actions">{actions}</div> : null}
		</div>
	)
}

export function KPI({
	label,
	value,
	delta,
	variant,
	viz,
}: {
	label: ReactNode
	value: ReactNode
	delta?: ReactNode
	variant?: "neg" | "warn" | "good"
	viz?: ReactNode
}) {
	return (
		<div className="jaf-kpi">
			<div>
				<div className="jaf-l">{label}</div>
				<div className={cn("jaf-v", variant && `jaf-${variant}`)}>{value}</div>
				{delta ? <div className="jaf-d">{delta}</div> : null}
			</div>
			{viz ? <div className="jaf-viz">{viz}</div> : null}
		</div>
	)
}

export function Box({
	children,
	className,
	span,
	accent,
	glance,
}: {
	children: ReactNode
	className?: string
	span?: 3 | 4 | 5 | 6 | 7 | 8 | 12
	accent?: boolean
	glance?: boolean
}) {
	return (
		<div
			className={cn(
				"jaf-box",
				span && `jaf-c${span}`,
				accent && "jaf-acc",
				glance && "jaf-glance",
				className,
			)}
		>
			{children}
		</div>
	)
}

export function Tag({
	children,
	tone = "default",
}: {
	children: ReactNode
	tone?: "default" | "ok" | "warn" | "crit" | "acc"
}) {
	return (
		<span className={cn("jaf-tag", tone !== "default" && `jaf-${tone}`)}>
			{children}
		</span>
	)
}

export function Note({
	children,
	tone = "warn",
}: {
	children: ReactNode
	tone?: "warn" | "crit" | "ok" | "acc" | "neutral"
}) {
	return (
		<div
			className={cn(
				"jaf-note",
				tone === "neutral" && "jaf-neutral",
				tone !== "warn" && tone !== "neutral" && `jaf-${tone}`,
			)}
		>
			{children}
		</div>
	)
}

export function Field({
	label,
	htmlFor,
	children,
}: {
	label: ReactNode
	htmlFor?: string
	children: ReactNode
}) {
	return (
		<div className="jaf-field">
			<label htmlFor={htmlFor}>{label}</label>
			{children}
		</div>
	)
}

export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
	return (
		<div className="jaf-stat">
			<div className="jaf-l">{label}</div>
			<div className="jaf-v">{value}</div>
		</div>
	)
}

export function Gate({
	items,
	live,
}: {
	items: {
		id: string
		ok: boolean | "warn"
		label: ReactNode
		detail?: ReactNode
	}[]
	live?: boolean
}) {
	return (
		<ul
			className="jaf-gate"
			{...(live ? { "aria-live": "polite" as const } : {})}
		>
			{items.map((item) => (
				<li key={item.id}>
					<span
						className={cn(
							"jaf-ic",
							item.ok === true
								? "jaf-y"
								: item.ok === "warn"
									? "jaf-w"
									: "jaf-n",
						)}
						aria-hidden
					>
						{item.ok === true ? "✓" : item.ok === "warn" ? "!" : "×"}
					</span>
					<span>{item.label}</span>
					{item.detail ? <small>{item.detail}</small> : null}
				</li>
			))}
		</ul>
	)
}

export const GUIDE_FLOW_STEPS = [
	{ n: 1, label: "Created" },
	{ n: 2, label: "Warehouse prep" },
	{ n: 3, label: "Crew signs out" },
	{ n: 4, label: "Field work" },
	{ n: 5, label: "You review" },
	{ n: 6, label: "JAF invoice" },
	{ n: 7, label: "Aviso matched" },
	{ n: 8, label: "To Finance" },
] as const

export function FlowStrip({
	current,
	you,
}: {
	current: number
	you?: number[]
}) {
	return (
		<div className="jaf-flow">
			{GUIDE_FLOW_STEPS.map((step) => {
				const done = step.n < current
				const on = step.n === current
				const yours = you?.includes(step.n)
				return (
					<div
						key={step.n}
						className={cn(
							done && "jaf-done",
							on && "jaf-on",
							yours && "jaf-you",
						)}
					>
						<b>{step.n}</b>
						<span>{step.label}</span>
					</div>
				)
			})}
		</div>
	)
}

export function SegmentedControl({
	tabs,
	active,
	onSelect,
}: {
	tabs: { id: string; label: ReactNode }[]
	active: string
	onSelect: (id: string) => void
}) {
	return (
		<div className="jaf-tabs" role="tablist">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-selected={active === tab.id}
					className={cn(active === tab.id && "jaf-on")}
					onClick={() => onSelect(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	)
}

export function Back({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link to={to} className="jaf-back">
			{children}
		</Link>
	)
}

export function DsButton({
	children,
	className,
	variant = "solid",
	size,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "solid" | "ghost" | "acc" | "blue"
	size?: "sm"
}) {
	return (
		<button
			className={cn(
				"jaf-btn",
				variant !== "solid" && `jaf-${variant}`,
				size === "sm" && "jaf-sm",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	)
}
