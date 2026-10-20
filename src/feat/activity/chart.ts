import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"

// A line chart of one count over time, drawn as SVG: the line, a light wash
// under it, quiet gridlines, and a crosshair that finds the nearest sample
// under the pointer or arrow keys. A table of the same points sits under it.

export interface ChartPoint {
	at: number
	value: number
}

const SVG = "http://www.w3.org/2000/svg"
const HEIGHT = 180
const MARGIN = { top: 10, right: 10, bottom: 24, left: 46 }
const MAX_POINTS = 240

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
	const element = document.createElementNS(SVG, tag)
	for (const [key, value] of Object.entries(attrs)) {
		element.setAttribute(key, String(value))
	}
	return element
}

/** 1,234,567 as 1.2M, for axes where width matters. */
export const compactNumber = (value: number): string => {
	const abs = Math.abs(value)
	const unit = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : null

	if (!unit) {
		return String(Math.round(value))
	}

	const scaled = value / (unit[0] as number)
	return `${Number(scaled.toFixed(Math.abs(scaled) < 10 ? 1 : 0))}${unit[1]}`
}

/** Round tick steps that cover min to max in about four steps. */
const niceTicks = (min: number, max: number) => {
	if (min === max) {
		min = Math.max(0, min - 1)
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
 * Fewer points for a long history, each the average of its slice of time, so
 * a year draws as fast as a day. Gaps between samples stay gaps.
 */
const downsample = (points: ChartPoint[]): ChartPoint[] => {
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

	return [...buckets.values()].map((list) => ({
		at: list.reduce((sum, point) => sum + point.at, 0) / list.length,
		value: list.reduce((sum, point) => sum + point.value, 0) / list.length,
	}))
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

/** A chart of `points`, oldest first, labelled `label`, with values written by `format`. */
export const lineChart = (
	label: string,
	allPoints: ChartPoint[],
	format: (value: number) => string = (value) => Math.round(value).toLocaleString("en-US"),
): HTMLElement => {
	const figure = html`<figure class="btr-chart">
		<figcaption class="btr-chart-title">${label}</figcaption>
		<div class="btr-chart-plot" tabindex="0" role="img"></div>
		<details class="btr-chart-table">
			<summary>Show as table</summary>
			<table>
				<thead>
					<tr>
						<th>Time</th>
						<th>${label}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		</details>
	</figure>`

	const plot = figure.$req(".btr-chart-plot")

	if (allPoints.length < 2) {
		plot.replaceWith(
			html`<p class="btr-chart-empty">Not enough samples yet. One is taken every check.</p>`,
		)
		figure.$req(".btr-chart-table").remove()
		return figure
	}

	const points = downsample(allPoints)
	const first = points[0].at
	const last = points.at(-1)!.at
	const span = last - first
	const values = points.map((point) => point.value)
	const ticks = niceTicks(Math.min(...values), Math.max(...values))
	const low = ticks[0]
	const high = ticks.at(-1)!

	plot.setAttribute(
		"aria-label",
		`${label}, from ${format(points[0].value)} to ${format(points.at(-1)!.value)} between ${fullTime(first)} and ${fullTime(last)}`,
	)

	const draw = () => {
		const width = Math.max(240, plot.clientWidth || 456)
		const innerWidth = width - MARGIN.left - MARGIN.right
		const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
		const x = (at: number) => MARGIN.left + ((at - first) / (span || 1)) * innerWidth
		const y = (value: number) =>
			MARGIN.top + innerHeight - ((value - low) / (high - low || 1)) * innerHeight

		const chart = svg("svg", {
			width,
			height: HEIGHT,
			viewBox: `0 0 ${width} ${HEIGHT}`,
			"aria-hidden": "true",
		})

		for (const tick of ticks) {
			chart.append(
				svg("line", {
					x1: MARGIN.left,
					x2: width - MARGIN.right,
					y1: y(tick),
					y2: y(tick),
					class: "btr-chart-grid",
				}),
			)
			const text = svg("text", {
				x: MARGIN.left - 8,
				y: y(tick) + 4,
				class: "btr-chart-axis",
				"text-anchor": "end",
			})
			text.textContent = compactNumber(tick)
			chart.append(text)
		}

		for (let i = 0; i < 4; i++) {
			const at = first + (span * i) / 3
			const text = svg("text", {
				x: x(at),
				y: HEIGHT - 6,
				class: "btr-chart-axis",
				"text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle",
			})
			text.textContent = timeLabel(at, span)
			chart.append(text)
		}

		for (const run of runs(points)) {
			const line = run.map((point, i) => `${i ? "L" : "M"}${x(point.at)},${y(point.value)}`).join("")

			if (run.length > 1) {
				chart.append(
					svg("path", {
						d: `${line}L${x(run.at(-1)!.at)},${y(low)}L${x(run[0].at)},${y(low)}Z`,
						class: "btr-chart-area",
					}),
				)
			}

			chart.append(svg("path", { d: line, class: "btr-chart-line" }))

			// A lone sample between gaps is still shown.
			if (run.length === 1) {
				chart.append(
					svg("circle", { cx: x(run[0].at), cy: y(run[0].value), r: 3, class: "btr-chart-dot" }),
				)
			}
		}

		const cross = svg("line", { y1: MARGIN.top, y2: MARGIN.top + innerHeight, class: "btr-chart-cross" })
		const dot = svg("circle", { r: 4, class: "btr-chart-dot btr-chart-focus" })
		cross.style.display = dot.style.display = "none"
		chart.append(cross, dot)

		const tooltip = html`<div class="btr-chart-tooltip" hidden>
			<strong></strong>
			<span></span>
		</div>`

		const show = (index: number | null) => {
			if (index === null) {
				cross.style.display = dot.style.display = "none"
				tooltip.hidden = true
				return
			}

			const point = points[index]
			const px = x(point.at)
			cross.setAttribute("x1", String(px))
			cross.setAttribute("x2", String(px))
			dot.setAttribute("cx", String(px))
			dot.setAttribute("cy", String(y(point.value)))
			cross.style.display = dot.style.display = ""

			tooltip.$req("strong").textContent = format(point.value)
			tooltip.$req("span").textContent = fullTime(point.at)
			tooltip.hidden = false
			tooltip.style.left = `${Math.min(Math.max(px, 70), width - 70)}px`
		}

		let current: number | null = null

		const nearest = (clientX: number) => {
			const at =
				first + ((clientX - chart.getBoundingClientRect().left - MARGIN.left) / innerWidth) * span
			let best = 0

			for (let i = 1; i < points.length; i++) {
				if (Math.abs(points[i].at - at) < Math.abs(points[best].at - at)) {
					best = i
				}
			}

			return best
		}

		chart.addEventListener("pointermove", (ev) => show((current = nearest(ev.clientX))))
		chart.addEventListener("pointerleave", () => show((current = null)))

		plot.onkeydown = (ev: KeyboardEvent) => {
			if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
				ev.preventDefault()
				const step = ev.key === "ArrowLeft" ? -1 : 1
				current = Math.min(
					points.length - 1,
					Math.max(0, (current ?? points.length - 1) + (current === null ? 0 : step)),
				)
				show(current)
			}
		}

		plot.onfocus = () => show((current ??= points.length - 1))
		plot.onblur = () => show((current = null))
		plot.replaceChildren(chart, tooltip)
	}

	// Drawn once it has a width to fit, and again if that changes.
	new ResizeObserver(() => draw()).observe(plot)

	const body = figure.$req("tbody")

	for (const point of points.toReversed()) {
		const row = html`<tr>
			<td>${fullTime(point.at)}</td>
			<td>${format(point.value)}</td>
		</tr>`
		body.append(row)
	}

	return figure
}
