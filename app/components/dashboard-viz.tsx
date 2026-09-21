import { useId, useState } from "react"
import { cn } from "~/lib/utils"

/**
 * Small inline SVG visualisations for the dashboard cards. They read their
 * colours from the theme tokens so they follow light / dark automatically.
 */

const ACCENT = "var(--chart-1)"
const ACCENT_SOFT = "var(--chart-2)"
const CRITICAL = "var(--status-danger)"

function Ring({
	pct,
	caption,
	tone = "accent",
	label,
}: {
	pct: number
	caption: string
	tone?: "accent" | "critical"
	label: string
}) {
	const r = 21
	const c = 2 * Math.PI * r
	const clamped = Math.max(0, Math.min(100, pct))
	const stroke = tone === "critical" ? CRITICAL : ACCENT
	return (
		<svg
			className="size-13 shrink-0"
			viewBox="0 0 52 52"
			role="img"
			aria-label={label}
		>
			<circle
				cx="26"
				cy="26"
				r={r}
				fill="none"
				stroke={stroke}
				strokeOpacity={tone === "critical" ? 0.22 : 0.3}
				strokeWidth="5"
			/>
			<circle
				cx="26"
				cy="26"
				r={r}
				fill="none"
				stroke={stroke}
				strokeWidth="5"
				strokeLinecap="round"
				strokeDasharray={c}
				strokeDashoffset={c * (1 - clamped / 100)}
				transform="rotate(-90 26 26)"
			/>
			<text
				x="26"
				y="25"
				textAnchor="middle"
				className="fill-foreground text-[11px] font-semibold"
			>
				{clamped}%
			</text>
			<text
				x="26"
				y="35"
				textAnchor="middle"
				className="fill-muted-foreground text-[8px] font-medium"
			>
				{caption}
			</text>
		</svg>
	)
}

function Spark({ values, label }: { values: number[]; label: string }) {
	const W = 72
	const H = 34
	const pad = 4
	const id = useId()
	if (values.length < 2) {
		return <div className="h-[34px] w-[72px] shrink-0" aria-hidden="true" />
	}
	const max = Math.max(...values)
	const min = Math.min(...values)
	const span = max - min || 1
	const x = (i: number) => pad + ((W - 2 * pad) * i) / (values.length - 1)
	const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - min) / span)
	const d = values
		.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
		.join(" ")
	const last = values.length - 1
	return (
		<svg
			className="h-[34px] w-[72px] shrink-0"
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={label}
			aria-describedby={id}
		>
			<title id={id}>{label}</title>
			<path
				d={`${d} L${x(last).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`}
				fill={ACCENT}
				fillOpacity={0.12}
			/>
			<path
				d={d}
				fill="none"
				stroke={ACCENT}
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
			<circle
				cx={x(last)}
				cy={y(values[last] ?? 0)}
				r="3.5"
				fill={ACCENT}
				className="stroke-card"
				strokeWidth="2"
			/>
		</svg>
	)
}

function MiniBars({ values, label }: { values: number[]; label: string }) {
	const max = Math.max(1, ...values)
	const shown = values.slice(0, 5)
	return (
		<div
			className="flex h-[34px] shrink-0 items-end gap-[3px]"
			role="img"
			aria-label={label}
		>
			{shown.map((v, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
					key={i}
					className="block w-[9px] rounded-t-[3px]"
					style={{
						height: `${Math.max(8, (v / max) * 100)}%`,
						background:
							i === shown.length - 1 && shown.length > 1 ? ACCENT_SOFT : ACCENT,
					}}
				/>
			))}
		</div>
	)
}

function HBars({ rows }: { rows: { name: string; value: number }[] }) {
	const max = Math.max(1, ...rows.map((r) => r.value))
	return (
		<div className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
			{rows.map((r) => (
				<div key={r.name} className="contents">
					<div className="truncate text-[13px] font-medium">{r.name}</div>
					<div
						className="h-[9px] rounded-r"
						style={{
							width: `${(r.value / max) * 100}%`,
							background: ACCENT,
						}}
					/>
					<div className="text-xs tabular-nums text-muted-foreground">
						{r.value}
					</div>
				</div>
			))}
		</div>
	)
}

type TrendPoint = { label: string; sold: number; po: number }

function TrendChart({
	points,
	seriesLabels,
	openLabel,
	format,
}: {
	points: TrendPoint[]
	seriesLabels: { sold: string; po: string }
	openLabel: string
	format: (v: number) => string
}) {
	const [hover, setHover] = useState<number | null>(null)
	const W = 640
	const H = 230
	const L = 48
	const R = 60
	const T = 14
	const B = 30
	const n = points.length
	const rawMax = Math.max(1, ...points.map((p) => Math.max(p.sold, p.po)))
	const step = 10 ** Math.floor(Math.log10(rawMax))
	const max = Math.ceil(rawMax / step) * step
	const x = (i: number) => (n > 1 ? L + ((W - L - R) * i) / (n - 1) : L)
	const y = (v: number) => T + (H - T - B) * (1 - v / max)
	const path = (key: "sold" | "po") =>
		points
			.map(
				(p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`,
			)
			.join(" ")
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
	const bw = n > 1 ? (W - L - R) / (n - 1) : W - L - R
	const active = hover == null ? null : points[hover]

	return (
		<div className="relative">
			<svg
				className="block h-auto w-full"
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={`${seriesLabels.sold} / ${seriesLabels.po}`}
				onMouseLeave={() => setHover(null)}
			>
				{ticks.map((v) => (
					<g key={v}>
						<line
							x1={L}
							x2={W - R}
							y1={y(v)}
							y2={y(v)}
							className="stroke-border"
							strokeWidth="1"
						/>
						<text
							x={L - 8}
							y={y(v) + 4}
							textAnchor="end"
							className="fill-muted-foreground text-[11px]"
						>
							{format(v)}
						</text>
					</g>
				))}
				{points.map((p, i) => (
					<text
						key={p.label}
						x={x(i)}
						y={H - 8}
						textAnchor="middle"
						className="fill-muted-foreground text-[11px]"
					>
						{p.label}
					</text>
				))}
				<path
					d={path("sold")}
					fill="none"
					stroke={ACCENT}
					strokeWidth="2"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				<path
					d={path("po")}
					fill="none"
					stroke={ACCENT_SOFT}
					strokeWidth="2"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				{points.map((p, i) => (
					// biome-ignore lint/a11y/noStaticElementInteractions: hover-only tooltip on an SVG group
					<g
						key={p.label}
						onMouseEnter={() => setHover(i)}
						onFocus={() => setHover(i)}
					>
						<rect
							x={x(i) - bw / 2}
							y={T}
							width={bw}
							height={H - T - B}
							fill={hover === i ? "var(--accent)" : "transparent"}
							fillOpacity={hover === i ? 0.6 : 0}
						/>
						<circle
							cx={x(i)}
							cy={y(p.sold)}
							r="4.5"
							fill={ACCENT}
							className="stroke-card"
							strokeWidth="2"
						/>
						<circle
							cx={x(i)}
							cy={y(p.po)}
							r="4.5"
							fill={ACCENT_SOFT}
							className="stroke-card"
							strokeWidth="2"
						/>
					</g>
				))}
				{n > 0 && (
					<>
						<text
							x={x(n - 1) + 10}
							y={y(points[n - 1]?.sold ?? 0) + 4}
							className="fill-foreground text-[11.5px] font-semibold"
						>
							{seriesLabels.sold.split(" ")[0]}
						</text>
						<text
							x={x(n - 1) + 10}
							y={y(points[n - 1]?.po ?? 0) + 4}
							className="fill-foreground text-[11.5px] font-semibold"
						>
							{seriesLabels.po.split(" ")[0]}
						</text>
					</>
				)}
			</svg>
			{active && hover != null && (
				<div
					className="pointer-events-none absolute -translate-x-1/2 -translate-y-[110%] rounded-md bg-foreground px-2.5 py-2 text-xs whitespace-nowrap text-background shadow-md"
					style={{
						left: `${(x(hover) / W) * 100}%`,
						top: `${(Math.min(y(active.sold), y(active.po)) / H) * 100}%`,
					}}
				>
					<b className="font-semibold">{active.label}</b>
					<br />
					{seriesLabels.sold} {format(active.sold)}
					<br />
					{seriesLabels.po} {format(active.po)}
					<br />
					{openLabel} {format(active.sold - active.po)}
				</div>
			)}
		</div>
	)
}

function Legend({
	items,
	className,
}: {
	items: { label: string; tone: "accent" | "soft" | "critical" }[]
	className?: string
}) {
	const color = { accent: ACCENT, soft: ACCENT_SOFT, critical: CRITICAL }
	return (
		<div
			className={cn(
				"flex flex-wrap gap-4 text-xs text-muted-foreground",
				className,
			)}
		>
			{items.map((i) => (
				<span key={i.label} className="inline-flex items-center gap-1.5">
					<i
						className="inline-block h-[3px] w-3.5 rounded-sm"
						style={{ background: color[i.tone] }}
					/>
					{i.label}
				</span>
			))}
		</div>
	)
}

export { HBars, Legend, MiniBars, Ring, Spark, TrendChart }
