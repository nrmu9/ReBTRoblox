import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import { nextDay, startOfDay } from "@/feat/activity/shared"

// Charts for the activity dialogs, drawn as SVG: a line of one count over time
// that can also be read per day, plain per day bars, and a week of hours as a
// grid. Each finds the nearest value under the pointer or arrow keys, and has a
// table and a CSV of the same values.

export interface ChartPoint {
	at: number
	value: number
}

/** Something that happened at a moment, like a game update, shown on the time axis. */
export interface ChartMarker {
	at: number
	label: string
}

/** Writes an axis tick, with more decimals when asked so ticks close together differ. */
export type AxisFormat = (value: number, decimals?: number) => string

export interface ChartOptions {
	format?: (value: number) => string
	/** The axis ticks, which are compacted numbers unless said otherwise. */
	axis?: AxisFormat
	markers?: ChartMarker[]
	/** Holds each value until the next, for counts only known when they change. */
	step?: boolean
	/** Carries the last value of a step chart on to this time. */
	until?: number
	/** Offers a per day view: what each day gained, or its highest value. */
	daily?: "gain" | "peak"
}

export interface ChartBar {
	at: number
	value: number
	/** Says how far back the value reaches when that is not just its own day. */
	detail?: string
}

const SVG = "http://www.w3.org/2000/svg"
const HEIGHT = 180
const MARGIN = { top: 12, right: 10, bottom: 24, left: 46 }
const MAX_POINTS = 240
const BAR_MAX = 24

const defaultFormat = (value: number) => Math.round(value).toLocaleString("en-US")

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
	const element = document.createElementNS(SVG, tag)
	for (const [key, value] of Object.entries(attrs)) {
		element.setAttribute(key, String(value))
	}
	return element
}

/** 1,234,567 as 1.2M, for axes where width matters, with more decimals when asked. */
export const compactNumber = (value: number, decimals?: number): string => {
	const abs = Math.abs(value)
	const unit = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : null

	if (!unit) {
		return decimals ? String(Number(value.toFixed(decimals))) : String(Math.round(value))
	}

	const scaled = value / (unit[0] as number)
	return `${Number(scaled.toFixed(decimals ?? (Math.abs(scaled) < 10 ? 1 : 0)))}${unit[1]}`
}

/**
 * Tick labels that tell the ticks apart: a narrow range of big counts, like
 * visits, would otherwise label every tick 45B.
 */
const tickLabels = (ticks: number[], axis: AxisFormat = compactNumber) => {
	for (let decimals = 0; decimals <= 4; decimals++) {
		const labels = ticks.map((tick) => axis(tick, decimals || undefined))

		if (new Set(labels).size === labels.length) {
			return labels
		}
	}

	return ticks.map((tick) => tick.toLocaleString("en-US"))
}

/** Round tick steps that cover min to max in about four steps. */
const niceTicks = (min: number, max: number) => {
	if (min === max) {
		min = min > 0 ? Math.max(0, min - 1) : min - 1
		max = max + 1
	}

	const rough = (max - min) / 4
	const magnitude = 10 ** Math.floor(Math.log10(rough))
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough
	const low = Math.floor(min / step) * step
	const high = Math.ceil(max / step) * step
	const ticks: number[] = []

	for (let tick = low; tick <= high + step / 2; tick += step) {
		ticks.push(tick)
	}

	return ticks
}

/**
 * Fewer points for a long history, so a year draws as fast as a day: each the
 * average of its slice of time, or for a step chart the value it ended on.
 */
const downsample = (points: ChartPoint[], step: boolean): ChartPoint[] => {
	if (points.length <= MAX_POINTS) {
		return points
	}

	const from = points[0].at
	const span = (points.at(-1)!.at - from) / MAX_POINTS
	const buckets = new Map<number, ChartPoint[]>()

	for (const point of points) {
		const bucket = Math.min(MAX_POINTS - 1, Math.floor((point.at - from) / span))
		const list = buckets.get(bucket) ?? []
		list.push(point)
		buckets.set(bucket, list)
	}

	return [...buckets.values()].map((list) =>
		step
			? list.at(-1)!
			: {
					at: list.reduce((sum, point) => sum + point.at, 0) / list.length,
					value: list.reduce((sum, point) => sum + point.value, 0) / list.length,
				},
	)
}

/** Runs of points with no gap much longer than the usual spacing. */
const runs = (points: ChartPoint[]) => {
	const gaps = points.slice(1).map((point, i) => point.at - points[i].at)
	const usual = gaps.toSorted((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0
	const result: ChartPoint[][] = []

	points.forEach((point, i) => {
		if (i === 0 || point.at - points[i - 1].at > usual * 3) {
			result.push([point])
		} else {
			result.at(-1)!.push(point)
		}
	})

	return result
}

const timeLabel = (at: number, span: number) =>
	new Date(at).$format(span <= 2 * 24 * 60 * 60e3 ? clockFormat() : "MMM D")

const fullTime = (at: number) => new Date(at).$format(`MMM D, YYYY, ${clockFormat()}`)
const fullDay = (at: number) => new Date(at).$format("DDD, MMM D, YYYY")

/**
 * A value per day: what it gained since the day before it with samples, or
 * the highest it reached that day.
 */
const perDay = (points: ChartPoint[], mode: "gain" | "peak"): ChartBar[] => {
	const days = new Map<number, ChartPoint[]>()

	for (const point of points) {
		const day = startOfDay(point.at)
		const list = days.get(day) ?? []
		list.push(point)
		days.set(day, list)
	}

	const keys = [...days.keys()].toSorted((a, b) => a - b)

	return keys.map((day, i) => {
		const list = days.get(day)!

		if (mode === "peak") {
			return { at: day, value: Math.max(...list.map((point) => point.value)) }
		}

		const previous = i > 0 ? days.get(keys[i - 1])!.at(-1)! : list[0]
		const bar: ChartBar = { at: day, value: list.at(-1)!.value - previous.value }

		// A day or more with no samples folds into the next one with any.
		if (i > 0 && nextDay(keys[i - 1]) !== day) {
			bar.detail = `Since ${new Date(keys[i - 1]).$format("MMM D")}`
		}

		return bar
	})
}

/** A rectangle with 4px rounded corners at its data end and square at the baseline. */
const barPath = (x: number, width: number, base: number, end: number) => {
	const height = Math.abs(base - end)
	const r = Math.min(4, width / 2, height)
	const dir = end < base ? 1 : -1

	if (height < 0.5) {
		return `M${x},${base}h${width}v${-dir * 0.5}h${-width}Z`
	}

	return [
		`M${x},${base}`,
		`V${end + dir * r}`,
		`Q${x},${end} ${x + r},${end}`,
		`H${x + width - r}`,
		`Q${x + width},${end} ${x + width},${end + dir * r}`,
		`V${base}`,
		"Z",
	].join("")
}

const csvOf = (header: [string, string], rows: Array<[string, string | number]>) =>
	[header, ...rows]
		.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
		.join("\r\n")

/** A button that saves the chart's values, named after it. */
const csvLink = (label: string, rows: () => string) => {
	const link = html<HTMLButtonElement>`<button type="button" class="btr-chart-tool" title="Download as CSV">
		CSV
	</button>`

	link.$on("click", () => {
		const anchor = document.createElement("a")
		anchor.href = URL.createObjectURL(new Blob([rows()], { type: "text/csv" }))
		anchor.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().$format("YYYY-MM-DD")}.csv`
		anchor.click()
		setTimeout(() => URL.revokeObjectURL(anchor.href), 60e3)
	})

	return link
}

const figureOf = (label: string, valueHeader: string) =>
	html`<figure class="btr-chart">
		<div class="btr-chart-head">
			<figcaption class="btr-chart-title">${label}</figcaption>
			<div class="btr-chart-tools"></div>
		</div>
		<div class="btr-chart-plot" tabindex="0" role="img"></div>
		<div class="btr-chart-tablebox" tabindex="0" hidden>
			<table>
				<thead>
					<tr>
						<th class="btr-chart-time-header">Time</th>
						<th>${valueHeader}</th>
						<th class="btr-chart-change-header">Change</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		</div>
	</figure>`

/** A button that swaps the plot for its table, which scrolls in a box the plot's size. */
const tableSwitch = (figure: HTMLElement) => {
	const plot = figure.$req(".btr-chart-plot")
	const box = figure.$req(".btr-chart-tablebox")
	const button = html<HTMLButtonElement>`<button type="button" class="btr-chart-tool" aria-pressed="false">
		Table
	</button>`

	button.$on("click", () => {
		const table = button.getAttribute("aria-pressed") !== "true"
		button.setAttribute("aria-pressed", String(table))
		plot.hidden = table
		box.hidden = !table
	})

	return button
}

/** A difference as +1,234 or -56, with nothing for none. */
const changeText = (change: number, format: (value: number) => string) =>
	change > 0 ? `+${format(change)}` : change < 0 ? `-${format(-change)}` : ""

interface Hover {
	x: number
	y: number
	value: string
	time: string
	notes: string[]
}

/**
 * The parts every time chart shares: gridlines and both axes, a crosshair and
 * tooltip over the item nearest the pointer, arrow keys, and dragging across
 * the plot to pick a stretch of time.
 */
const frame = (
	plot: HTMLElement,
	options: {
		width: number
		first: number
		last: number
		ticks: number[]
		axis: AxisFormat | undefined
		hovers: Hover[]
		dot: boolean
		onSelect?: ((from: number, to: number) => void) | undefined
		/** Days the time axis is labelled at, instead of four even steps. */
		labelAt?: number[]
	},
) => {
	const { width, first, last, ticks } = options
	const span = last - first
	const innerWidth = width - MARGIN.left - MARGIN.right
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const low = ticks[0]
	const high = ticks.at(-1)!
	const x = (at: number) => MARGIN.left + ((at - first) / (span || 1)) * innerWidth
	const y = (value: number) => MARGIN.top + innerHeight - ((value - low) / (high - low || 1)) * innerHeight
	const timeAt = (px: number) => first + ((px - MARGIN.left) / innerWidth) * span

	const chart = svg("svg", {
		width,
		height: HEIGHT,
		viewBox: `0 0 ${width} ${HEIGHT}`,
		"aria-hidden": "true",
	})

	const labels = tickLabels(ticks, options.axis)

	ticks.forEach((tick, i) => {
		chart.append(
			svg("line", {
				x1: MARGIN.left,
				x2: width - MARGIN.right,
				y1: y(tick),
				y2: y(tick),
				class: tick === 0 && low < 0 ? "btr-chart-grid btr-chart-zero" : "btr-chart-grid",
			}),
		)
		const text = svg("text", {
			x: MARGIN.left - 8,
			y: y(tick) + 4,
			class: "btr-chart-axis",
			"text-anchor": "end",
		})
		text.textContent = labels[i]
		chart.append(text)
	})

	const labelAt = options.labelAt ?? [0, 1, 2, 3].map((i) => first + (span * i) / 3)

	labelAt.forEach((at, i) => {
		const text = svg("text", {
			x: x(at),
			y: HEIGHT - 6,
			class: "btr-chart-axis",
			"text-anchor": i === 0 ? "start" : i === labelAt.length - 1 ? "end" : "middle",
		})
		text.textContent = options.labelAt ? new Date(at).$format("MMM D") : timeLabel(at, span)
		chart.append(text)
	})

	const marks = svg("g", {})
	const cross = svg("line", { y1: MARGIN.top, y2: MARGIN.top + innerHeight, class: "btr-chart-cross" })
	const dot = svg("circle", { r: 4, class: "btr-chart-dot btr-chart-focus" })
	const selection = svg("rect", { y: MARGIN.top, height: innerHeight, class: "btr-chart-selection" })
	cross.style.display = dot.style.display = selection.style.display = "none"
	chart.append(marks, selection, cross, dot)

	const tooltip = html`<div class="btr-chart-tooltip" hidden>
		<strong></strong>
		<span></span>
	</div>`

	const show = (index: number | null) => {
		tooltip.$findAll(".btr-chart-note").forEach((note) => note.remove())

		if (index === null) {
			cross.style.display = dot.style.display = "none"
			tooltip.hidden = true
			return
		}

		const hover = options.hovers[index]
		cross.setAttribute("x1", String(hover.x))
		cross.setAttribute("x2", String(hover.x))
		dot.setAttribute("cx", String(hover.x))
		dot.setAttribute("cy", String(hover.y))
		cross.style.display = ""
		dot.style.display = options.dot ? "" : "none"

		tooltip.$req("strong").textContent = hover.value
		tooltip.$req("span").textContent = hover.time

		for (const note of hover.notes) {
			const line = html`<span class="btr-chart-note"></span>`
			line.textContent = note
			tooltip.append(line)
		}

		tooltip.hidden = false
		tooltip.style.left = `${Math.min(Math.max(hover.x, 80), width - 80)}px`
	}

	let current: number | null = null
	let dragFrom: number | null = null

	const localX = (clientX: number) => clientX - chart.getBoundingClientRect().left
	const clamp = (px: number) => Math.min(Math.max(px, MARGIN.left), width - MARGIN.right)

	const nearest = (px: number) => {
		let best = 0

		for (let i = 1; i < options.hovers.length; i++) {
			if (Math.abs(options.hovers[i].x - px) < Math.abs(options.hovers[best].x - px)) {
				best = i
			}
		}

		return best
	}

	chart.addEventListener("pointerdown", (ev) => {
		if (options.onSelect && ev.button === 0) {
			dragFrom = clamp(localX(ev.clientX))
			chart.setPointerCapture(ev.pointerId)
		}
	})

	chart.addEventListener("pointermove", (ev) => {
		const px = localX(ev.clientX)

		if (dragFrom !== null) {
			const to = clamp(px)
			selection.setAttribute("x", String(Math.min(dragFrom, to)))
			selection.setAttribute("width", String(Math.abs(to - dragFrom)))
			selection.style.display = ""
		}

		show((current = nearest(px)))
	})

	chart.addEventListener("pointerup", (ev) => {
		if (dragFrom === null) {
			return
		}

		const to = clamp(localX(ev.clientX))
		const from = dragFrom
		dragFrom = null
		selection.style.display = "none"

		// A click is not a selection.
		if (Math.abs(to - from) > 8) {
			options.onSelect?.(timeAt(Math.min(from, to)), timeAt(Math.max(from, to)))
		}
	})

	chart.addEventListener("pointerleave", () => {
		if (dragFrom === null) {
			show((current = null))
		}
	})

	plot.onkeydown = (ev: KeyboardEvent) => {
		if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
			ev.preventDefault()
			const step = ev.key === "ArrowLeft" ? -1 : 1
			current = Math.min(
				options.hovers.length - 1,
				Math.max(0, (current ?? options.hovers.length - 1) + (current === null ? 0 : step)),
			)
			show(current)
		}
	}

	plot.onfocus = () => show((current ??= options.hovers.length - 1))
	plot.onblur = () => show((current = null))
	plot.replaceChildren(chart, tooltip)

	return { marks, x, y, low, high, innerHeight, innerWidth }
}

/** Markers that fall after `from` and up to `to`, as tooltip lines. */
const notesBetween = (markers: ChartMarker[], from: number, to: number) =>
	markers
		.filter((marker) => marker.at > from && marker.at <= to)
		.map((marker) => `${marker.label}, ${new Date(marker.at).$format(`MMM D, ${clockFormat()}`)}`)

const drawLine = (
	plot: HTMLElement,
	points: ChartPoint[],
	options: Required<Pick<ChartOptions, "format">> & ChartOptions,
	onSelect: (from: number, to: number) => void,
) => {
	const until =
		options.step && options.until ? Math.max(options.until, points.at(-1)!.at) : points.at(-1)!.at
	const first = points[0].at
	const values = points.map((point) => point.value)
	const ticks = niceTicks(Math.min(...values), Math.max(...values))
	const width = Math.max(240, plot.clientWidth || 456)
	const markers = (options.markers ?? []).filter((marker) => marker.at >= first && marker.at <= until)

	// Positions first, so the hover list can be built before drawing.
	const span = until - first || 1
	const innerWidth = width - MARGIN.left - MARGIN.right
	const px = (at: number) => MARGIN.left + ((at - first) / span) * innerWidth
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const py = (value: number) =>
		MARGIN.top + innerHeight - ((value - ticks[0]) / (ticks.at(-1)! - ticks[0] || 1)) * innerHeight

	const hovers: Hover[] = points.map((point, i) => ({
		x: px(point.at),
		y: py(point.value),
		value: options.format(point.value),
		time: fullTime(point.at),
		notes: notesBetween(markers, i ? points[i - 1].at : -Infinity, point.at),
	}))

	const { marks, x, y, low } = frame(plot, {
		width,
		first,
		last: until,
		ticks,
		axis: options.axis,
		hovers,
		dot: true,
		onSelect,
	})

	for (const marker of markers) {
		marks.append(
			svg("line", {
				x1: x(marker.at),
				x2: x(marker.at),
				y1: MARGIN.top,
				y2: HEIGHT - MARGIN.bottom,
				class: "btr-chart-marker",
			}),
			svg("circle", { cx: x(marker.at), cy: MARGIN.top, r: 4, class: "btr-chart-marker-dot" }),
		)
	}

	const pathOf = (run: ChartPoint[], end: number) =>
		options.step
			? run
					.map((point, i) => `${i ? `H${x(point.at)}V` : `M${x(point.at)},`}${y(point.value)}`)
					.join("") + `H${x(end)}`
			: run.map((point, i) => `${i ? "L" : "M"}${x(point.at)},${y(point.value)}`).join("")

	// A step chart's value holds between changes, so it is one run to the end.
	const lineRuns = options.step ? [points] : runs(points)

	lineRuns.forEach((run, i) => {
		const end = options.step && i === lineRuns.length - 1 ? until : run.at(-1)!.at
		const line = pathOf(run, end)

		if (run.length > 1 || end > run[0].at) {
			marks.append(
				svg("path", {
					d: `${line}L${x(end)},${y(low)}L${x(run[0].at)},${y(low)}Z`,
					class: "btr-chart-area",
				}),
			)
		}

		marks.append(svg("path", { d: line, class: "btr-chart-line" }))

		// A lone sample between gaps is still shown.
		if (run.length === 1 && end === run[0].at) {
			marks.append(
				svg("circle", { cx: x(run[0].at), cy: y(run[0].value), r: 4, class: "btr-chart-dot" }),
			)
		}
	})
}

const drawBars = (
	plot: HTMLElement,
	bars: ChartBar[],
	format: (value: number) => string,
	axis: AxisFormat | undefined,
	markers: ChartMarker[],
	onSelect?: (from: number, to: number) => void,
) => {
	const width = Math.max(240, plot.clientWidth || 456)
	const values = bars.map((bar) => bar.value)
	const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))

	// Each bar sits in the middle of its day, so the axis runs half a day past
	// the first and last.
	const first = bars[0].at
	const last = nextDay(bars.at(-1)!.at)
	const innerWidth = width - MARGIN.left - MARGIN.right
	const band = innerWidth / Math.max(1, (last - first) / (24 * 60 * 60e3))
	const barWidth = Math.max(2, Math.min(BAR_MAX, band * 0.7))
	const centre = (bar: ChartBar) => bar.at + (nextDay(bar.at) - bar.at) / 2
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const py = (value: number) =>
		MARGIN.top + innerHeight - ((value - ticks[0]) / (ticks.at(-1)! - ticks[0] || 1)) * innerHeight

	const hovers: Hover[] = bars.map((bar) => ({
		x: MARGIN.left + ((centre(bar) - first) / (last - first)) * innerWidth,
		y: py(bar.value),
		value: format(bar.value),
		time: bar.detail ? `${fullDay(bar.at)} · ${bar.detail}` : fullDay(bar.at),
		notes: notesBetween(markers, bar.at - 1, nextDay(bar.at) - 1),
	}))

	// Labelled at days that have bars, as the axis runs on to the end of the last.
	const labelled = [...new Set([0, 1, 2, 3].map((i) => Math.round(((bars.length - 1) * i) / 3)))]
	const labelAt = labelled.map((i) => centre(bars[i]))

	const { marks, x, y } = frame(plot, {
		width,
		first,
		last,
		ticks,
		axis,
		hovers,
		dot: false,
		onSelect,
		labelAt,
	})

	for (const bar of bars) {
		marks.append(
			svg("path", {
				d: barPath(x(centre(bar)) - barWidth / 2, barWidth, y(0), y(bar.value)),
				class: "btr-chart-bar",
			}),
		)
	}

	for (const marker of markers.filter((m) => m.at >= first && m.at < last)) {
		marks.append(svg("circle", { cx: x(marker.at), cy: MARGIN.top, r: 4, class: "btr-chart-marker-dot" }))
	}
}

const segmented = (choices: Array<[string, string]>, value: string, onChange: (value: string) => void) => {
	const group = html`<div class="btr-chart-views" role="group" aria-label="View"></div>`

	for (const [key, label] of choices) {
		const button = html`<button type="button" aria-pressed="${key === value}">${label}</button>`

		button.$on("click", () => {
			for (const other of group.$findAll("button")) {
				other.setAttribute("aria-pressed", String(other === button))
			}
			onChange(key)
		})

		group.append(button)
	}

	return group
}

/** A chart of `points`, oldest first, labelled `label`. */
export const lineChart = (
	label: string,
	allPoints: ChartPoint[],
	options: ChartOptions = {},
): HTMLElement => {
	const format = options.format ?? defaultFormat
	const figure = figureOf(label, label)
	const plot = figure.$req(".btr-chart-plot")
	const tools = figure.$req(".btr-chart-tools")
	const body = figure.$req("tbody")

	if (allPoints.length < (options.step ? 1 : 2)) {
		plot.replaceWith(
			html`<p class="btr-chart-empty">Not enough samples yet. One is taken every check.</p>`,
		)
		figure.$req(".btr-chart-tablebox").remove()
		return figure
	}

	const state = { view: "line", from: -Infinity, to: Infinity }
	const reset = html<HTMLButtonElement>`<button type="button" class="btr-chart-reset" hidden>
		Reset zoom
	</button>`

	/** The points inside the chosen stretch, with the value a step chart carried into it. */
	const visible = () => {
		const inside = allPoints.filter((point) => point.at >= state.from && point.at <= state.to)

		if (options.step && state.from > -Infinity) {
			const before = allPoints.findLast((point) => point.at < state.from)
			if (before) {
				inside.unshift({ at: state.from, value: before.value })
			}
		}

		return inside
	}

	const select = (from: number, to: number) => {
		state.from = from
		state.to = to
		reset.hidden = false
		render()
	}

	reset.$on("click", () => {
		state.from = -Infinity
		state.to = Infinity
		reset.hidden = true
		render()
	})

	let rows: Array<[string, string | number]> = []

	const render = () => {
		const points = downsample(visible(), !!options.step)
		const minimum = options.step ? 1 : 2

		if (points.length < minimum) {
			plot.replaceChildren(html`<p class="btr-chart-empty">No samples in this stretch.</p>`)
			return
		}

		const until = Math.min(state.to, options.until ?? points.at(-1)!.at)
		const header = figure.$req(".btr-chart-time-header")
		const changeHeader = figure.$req(".btr-chart-change-header")
		body.replaceChildren()

		if (state.view === "daily") {
			const bars = perDay(visible(), options.daily!)
			const byDay = options.daily === "gain" ? `${label} gained` : `Highest ${label.toLowerCase()}`

			plot.setAttribute("aria-label", `${byDay} per day, ${bars.length} days`)
			drawBars(plot, bars, format, options.axis, options.markers ?? [], select)

			header.textContent = "Day"
			changeHeader.hidden = true
			rows = bars.toReversed().map((bar) => [new Date(bar.at).$format("YYYY-MM-DD"), bar.value])

			for (const bar of bars.toReversed()) {
				const value =
					options.daily === "gain" ? changeText(bar.value, format) || "0" : format(bar.value)
				body.append(
					html`<tr>
						<td>${fullDay(bar.at)}</td>
						<td>${value}</td>
					</tr>`,
				)
			}
			return
		}

		plot.setAttribute(
			"aria-label",
			`${label}, from ${format(points[0].value)} to ${format(points.at(-1)!.value)} between ${fullTime(points[0].at)} and ${fullTime(until)}`,
		)
		drawLine(plot, points, { ...options, format, until }, select)

		header.textContent = "Time"
		changeHeader.hidden = false
		rows = points.toReversed().map((point) => [new Date(point.at).toISOString(), point.value])

		// Newest first, each with how far it moved from the one before it.
		points.toReversed().forEach((point, i, newest) => {
			const older = newest[i + 1]
			const change = older ? changeText(point.value - older.value, format) : ""
			body.append(
				html`<tr>
					<td>${fullTime(point.at)}</td>
					<td>${format(point.value)}</td>
					<td class="btr-chart-change">${change}</td>
				</tr>`,
			)
		})
	}

	tools.append(reset)

	if (options.daily) {
		tools.append(
			segmented(
				[
					["line", "Over time"],
					["daily", "Per day"],
				],
				state.view,
				(view) => {
					state.view = view
					render()
				},
			),
		)
	}

	tools.append(
		tableSwitch(figure),
		csvLink(label, () => csvOf([state.view === "daily" ? "day" : "time", label], rows)),
	)

	// Drawn once it has a width to fit, and again if that changes.
	new ResizeObserver(() => render()).observe(plot)

	return figure
}

/** Bars of a value per day, oldest first. */
export const barChart = (
	label: string,
	bars: ChartBar[],
	options: { format?: (value: number) => string; axis?: AxisFormat; empty?: string } = {},
): HTMLElement => {
	const format = options.format ?? defaultFormat
	const figure = figureOf(label, label)
	const plot = figure.$req(".btr-chart-plot")
	figure.$req(".btr-chart-time-header").textContent = "Day"
	figure.$req(".btr-chart-change-header").remove()

	if (!bars.length) {
		plot.replaceWith(html`<p class="btr-chart-empty">${options.empty ?? "Nothing to show yet."}</p>`)
		figure.$req(".btr-chart-tablebox").remove()
		return figure
	}

	plot.setAttribute("aria-label", `${label}, ${bars.length} days`)

	const body = figure.$req("tbody")
	for (const bar of bars.toReversed()) {
		body.append(
			html`<tr>
				<td>${fullDay(bar.at)}</td>
				<td>${format(bar.value)}</td>
			</tr>`,
		)
	}

	figure.$req(".btr-chart-tools").append(
		tableSwitch(figure),
		csvLink(label, () =>
			csvOf(
				["day", label],
				bars.toReversed().map((bar) => [new Date(bar.at).$format("YYYY-MM-DD"), bar.value]),
			),
		),
	)

	new ResizeObserver(() => drawBars(plot, bars, format, options.axis, [])).observe(plot)
	return figure
}

const HEAT_STEPS = 5
const CELL_HEIGHT = 18

/**
 * A week as rows of days and columns of hours, each cell as dark as its value
 * against the busiest one. `cells[day][hour]` starts the week on Monday.
 */
export const weekHeatmap = (
	label: string,
	cells: number[][],
	options: { format?: (value: number) => string; cell?: (value: number) => string } = {},
): HTMLElement => {
	const format = options.format ?? defaultFormat
	const cell = options.cell ?? format
	const figure = html`<figure class="btr-chart">
		<div class="btr-chart-head">
			<figcaption class="btr-chart-title">${label}</figcaption>
			<div class="btr-chart-tools">
				<div class="btr-heat-legend" aria-hidden="true">
					<span>Less</span>
					<span class="btr-heat-swatches"></span>
					<span>More</span>
				</div>
			</div>
		</div>
		<div class="btr-chart-plot btr-heat-plot" tabindex="0" role="img"></div>
		<div class="btr-chart-tablebox btr-heat-table" tabindex="0" hidden>
			<table></table>
		</div>
	</figure>`

	// January 1st 2024 was a Monday.
	const dayNames = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).$format("DDD"))
	const hourName = (hour: number) =>
		new Date(2024, 0, 1, hour).$format(clockFormat().includes("A") ? "h A" : "HH:00")
	const max = Math.max(0, ...cells.flat())
	const stepOf = (value: number) =>
		value <= 0 || !max ? 0 : Math.max(1, Math.ceil((value / max) * HEAT_STEPS))

	const swatches = figure.$req(".btr-heat-swatches")
	for (let step = 1; step <= HEAT_STEPS; step++) {
		swatches.append(html`<span class="btr-heat-swatch" data-step="${step}"></span>`)
	}

	const plot = figure.$req(".btr-chart-plot")
	plot.setAttribute("aria-label", `${label}, by weekday and hour`)

	const left = 40
	const top = 4
	const bottom = 20
	const height = top + CELL_HEIGHT * 7 + bottom

	const draw = () => {
		const width = Math.max(240, plot.clientWidth || 456)
		const cellWidth = (width - left - 4) / 24
		const chart = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" })

		dayNames.forEach((name, day) => {
			const text = svg("text", {
				x: left - 8,
				y: top + day * CELL_HEIGHT + CELL_HEIGHT / 2 + 4,
				class: "btr-chart-axis",
				"text-anchor": "end",
			})
			text.textContent = name
			chart.append(text)

			for (let hour = 0; hour < 24; hour++) {
				chart.append(
					svg("rect", {
						x: left + hour * cellWidth + 1,
						y: top + day * CELL_HEIGHT + 1,
						width: Math.max(1, cellWidth - 2),
						height: CELL_HEIGHT - 2,
						rx: 3,
						class: "btr-heat-cell",
						"data-step": stepOf(cells[day][hour]),
					}),
				)
			}
		})

		for (const hour of [0, 6, 12, 18]) {
			const text = svg("text", {
				x: left + hour * cellWidth,
				y: height - 6,
				class: "btr-chart-axis",
			})
			text.textContent = hourName(hour)
			chart.append(text)
		}

		const focus = svg("rect", { width: cellWidth, height: CELL_HEIGHT, rx: 4, class: "btr-heat-focus" })
		focus.style.display = "none"
		chart.append(focus)

		const tooltip = html`<div class="btr-chart-tooltip" hidden>
			<strong></strong>
			<span></span>
		</div>`

		let current: [number, number] | null = null

		const show = (cell: [number, number] | null) => {
			current = cell

			if (!cell) {
				focus.style.display = "none"
				tooltip.hidden = true
				return
			}

			const [day, hour] = cell
			focus.setAttribute("x", String(left + hour * cellWidth))
			focus.setAttribute("y", String(top + day * CELL_HEIGHT))
			focus.style.display = ""
			tooltip.$req("strong").textContent = format(cells[day][hour])
			tooltip.$req("span").textContent =
				`${dayNames[day]}, ${hourName(hour)} to ${hourName((hour + 1) % 24)}`
			tooltip.hidden = false
			tooltip.style.left = `${Math.min(Math.max(left + (hour + 0.5) * cellWidth, 80), width - 80)}px`
			tooltip.style.top = `${top + day * CELL_HEIGHT - 4}px`
		}

		chart.addEventListener("pointermove", (ev) => {
			const rect = chart.getBoundingClientRect()
			const hour = Math.floor((ev.clientX - rect.left - left) / cellWidth)
			const day = Math.floor((ev.clientY - rect.top - top) / CELL_HEIGHT)
			show(hour >= 0 && hour < 24 && day >= 0 && day < 7 ? [day, hour] : null)
		})
		chart.addEventListener("pointerleave", () => show(null))

		plot.onkeydown = (ev: KeyboardEvent) => {
			const moves: Record<string, [number, number]> = {
				ArrowLeft: [0, -1],
				ArrowRight: [0, 1],
				ArrowUp: [-1, 0],
				ArrowDown: [1, 0],
			}
			const move = moves[ev.key]

			if (move) {
				ev.preventDefault()
				const [day, hour] = current ?? [0, 0]
				show([Math.min(6, Math.max(0, day + move[0])), Math.min(23, Math.max(0, hour + move[1]))])
			}
		}

		plot.onfocus = () => show(current ?? [0, 0])
		plot.onblur = () => show(null)
		plot.replaceChildren(chart, tooltip)
	}

	new ResizeObserver(() => draw()).observe(plot)

	// Hours down and days across, so the table fits without scrolling sideways.
	const table = figure.$req("table")
	const head = html`<thead>
		<tr>
			<th>Hour</th>
		</tr>
	</thead>`
	const body = document.createElement("tbody")

	for (const name of dayNames) {
		head.$req("tr").append(html`<th>${name}</th>`)
	}

	for (let hour = 0; hour < 24; hour++) {
		const row = html`<tr>
			<td>${hourName(hour)}</td>
		</tr>`
		for (let day = 0; day < 7; day++) {
			row.append(html`<td>${cells[day][hour] ? cell(cells[day][hour]) : ""}</td>`)
		}
		body.append(row)
	}

	table.append(head, body)

	figure.$req(".btr-chart-tools").append(
		tableSwitch(figure),
		csvLink(label, () =>
			[
				["day", ...[...Array(24)].map((_, hour) => String(hour))],
				...dayNames.map((name, day) => [name].concat(cells[day].map(String))),
			]
				.map((row) => row.join(","))
				.join("\r\n"),
		),
	)

	return figure
}
