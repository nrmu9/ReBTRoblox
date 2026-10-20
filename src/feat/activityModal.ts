import { html } from "@/core/html"
import { onPresenceHistoryChange, getPresenceHistory, type PresenceSegment } from "@/feat/presenceHistory"

// The activity a profile's last seen opens: everything ReBTRoblox saw the
// user doing, over the page like the settings panel. Each day is a bar across
// its 24 hours for the overview, and opens into a list for the details.

const DAY = 24 * 60 * 60e3

// When a segment ended: when the next one began if that was seen live,
// otherwise the last time it was seen. The current one runs until now.
const segmentEnd = (segments: PresenceSegment[], index: number, online: boolean) => {
	const next = segments[index + 1]

	if (!next && online && segments[index].type > 0) {
		return Date.now()
	}

	return next?.exact ? next.from : segments[index].to
}

/** When the user was last seen online, or null if never. */
export const lastSeenAt = (segments: PresenceSegment[]): number | null => {
	for (let i = segments.length; i--;) {
		if (segments[i].type > 0) {
			return segmentEnd(segments, i, false)
		}
	}

	return null
}

const formatDuration = (ms: number) => {
	const minutes = Math.round(ms / 60e3)

	if (minutes < 1) {
		return "<1m"
	}

	const hours = Math.floor(minutes / 60)
	return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** Time online that falls after `since`. */
const onlineSince = (segments: PresenceSegment[], online: boolean, since: number) => {
	let total = 0

	segments.forEach((segment, index) => {
		if (segment.type > 0) {
			total += Math.max(0, segmentEnd(segments, index, online) - Math.max(segment.from, since))
		}
	})

	return total
}

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

// Through the date rather than adding 24 hours, which DST days are not.
const nextDay = (day: number) => {
	const date = new Date(day)
	date.setDate(date.getDate() + 1)
	return date.getTime()
}

const dayLabel = (day: number) => {
	if (day === startOfDay(Date.now())) {
		return "Today"
	}

	if (day === startOfDay(Date.now() - DAY)) {
		return "Yesterday"
	}

	return new Date(day).$format("DDD, MMM D")
}

const STATE_LABELS = ["Offline", "Online on the website", "In an experience", "In Studio"]

const stateText = (segment: PresenceSegment) =>
	segment.type === 2 && segment.location
		? `Playing ${segment.location}`
		: segment.type === 3 && segment.location
			? `In Studio, ${segment.location}`
			: STATE_LABELS[segment.type]

interface Block {
	index: number
	start: number
	end: number
}

/** Online time cut at midnight, by the start of each day. */
const blocksByDay = (segments: PresenceSegment[], online: boolean) => {
	const days = new Map<number, Block[]>()

	segments.forEach((segment, index) => {
		if (segment.type === 0) {
			return
		}

		const end = Math.max(segmentEnd(segments, index, online), segment.from)
		let day = startOfDay(segment.from)

		do {
			const next = nextDay(day)
			const blocks = days.get(day) ?? []

			blocks.push({ index, start: Math.max(segment.from, day), end: Math.min(end, next) })
			days.set(day, blocks)
			day = next
		} while (day < end)
	})

	return days
}

const entry = (segments: PresenceSegment[], index: number, online: boolean) => {
	const segment = segments[index]
	const from = new Date(segment.from)
	const end = segmentEnd(segments, index, online)
	const current = online && index === segments.length - 1 && segment.type > 0

	const item = html`<li class="btr-activity-entry" data-type="${segment.type}">
		<span class="btr-activity-node" aria-hidden="true"></span>
		<div class="btr-activity-text">
			<div class="btr-activity-state"></div>
			<div class="btr-activity-when"></div>
		</div>
	</li>`

	const state = item.$req(".btr-activity-state")

	if (segment.type === 0) {
		state.textContent = "Went offline"
	} else if (segment.type === 2 && segment.location && segment.placeId) {
		state.append("Playing ", html`<a href="/games/${segment.placeId}">${segment.location}</a>`)
	} else {
		state.textContent = stateText(segment)
	}

	// Offline only matters for when it began, and a state seen once has no span.
	const when = item.$req(".btr-activity-when")

	if (segment.type === 0 || (!current && end - segment.from < 60e3)) {
		when.textContent = from.$format("h:mm A")
	} else {
		const until = current ? "now" : new Date(end).$format("h:mm A")
		when.textContent = `${from.$format("h:mm A")} – ${until} · ${formatDuration(end - segment.from)}`
	}

	// Started before it was noticed, so the real start may be earlier.
	if (segment.type > 0 && !segment.exact) {
		when.title = "First seen at this time"
	}

	return item
}

const dayRow = (
	segments: PresenceSegment[],
	online: boolean,
	day: number,
	blocks: Block[],
	expanded: Set<number>,
	rerender: () => void,
) => {
	const length = nextDay(day) - day
	const total = blocks.reduce((sum, block) => sum + block.end - block.start, 0)
	const open = expanded.has(day)
	const label = dayLabel(day)

	const row = html`<div class="btr-activity-day">
		<button type="button" class="btr-activity-day-row" aria-expanded="${open}" data-day="${day}">
			<span class="btr-activity-day-label">${label}</span>
			<span class="btr-activity-bar"></span>
			<span class="btr-activity-day-total">${formatDuration(total)}</span>
		</button>
	</div>`

	const toggle = row.$req(".btr-activity-day-row")
	toggle.setAttribute("aria-label", `${label}, online ${formatDuration(total)}`)
	toggle.$on("click", () => {
		if (open) {
			expanded.delete(day)
		} else {
			expanded.add(day)
		}

		// The rows are rebuilt, so focus goes back to this day's new one.
		rerender()
		document.querySelector<HTMLElement>(`.btr-activity-day-row[data-day="${day}"]`)?.focus()
	})

	const bar = row.$req(".btr-activity-bar")

	for (const block of blocks) {
		const segment = segments[block.index]
		const piece = html`<span class="btr-activity-block" data-type="${segment.type}"></span>`
		const range = `${new Date(block.start).$format("h:mm A")} – ${new Date(block.end).$format("h:mm A")}`

		piece.style.left = `${((block.start - day) / length) * 100}%`
		piece.style.width = `${((block.end - block.start) / length) * 100}%`
		piece.title = `${stateText(segment)}\n${range} · ${formatDuration(block.end - block.start)}`
		bar.append(piece)
	}

	if (day === startOfDay(Date.now())) {
		const now = html`<span class="btr-activity-now"></span>`
		now.style.left = `${((Date.now() - day) / length) * 100}%`
		bar.append(now)
	}

	if (open) {
		const list = html`<ol class="btr-activity-day-list"></ol>`

		for (let i = segments.length; i--;) {
			const segment = segments[i]
			const inDay =
				segment.type === 0
					? segment.from >= day && segment.from < day + length
					: blocks.some((block) => block.index === i)

			if (inDay) {
				list.append(entry(segments, i, online))
			}
		}

		row.append(list)
	}

	return row
}

const render = (body: HTMLElement, segments: PresenceSegment[], online: boolean, expanded: Set<number>) => {
	const seen = lastSeenAt(segments)

	const summary = html`<div class="btr-activity-summary">
		<div class="btr-activity-stat">
			<div class="btr-activity-stat-label">${online ? "Status" : "Last seen"}</div>
			<div class="btr-activity-stat-value"></div>
		</div>
		<div class="btr-activity-stat">
			<div class="btr-activity-stat-label">Today</div>
			<div class="btr-activity-stat-value">
				${formatDuration(onlineSince(segments, online, startOfDay(Date.now())))}
			</div>
		</div>
		<div class="btr-activity-stat">
			<div class="btr-activity-stat-label">Last 7 days</div>
			<div class="btr-activity-stat-value">
				${formatDuration(onlineSince(segments, online, Date.now() - 7 * DAY))}
			</div>
		</div>
	</div>`

	const status = summary.$req(".btr-activity-stat-value")

	if (online) {
		status.textContent = "Online now"
	} else if (seen) {
		status.textContent = new Date(seen).$since()
		status.title = new Date(seen).$format("MMM D, YYYY, h:mm A")
	} else {
		status.textContent = "Not yet"
	}

	const timeline = html`<div class="btr-activity-timeline">
		<div class="btr-activity-scale" aria-hidden="true">
			<span>12 AM</span>
			<span>6 AM</span>
			<span>12 PM</span>
			<span>6 PM</span>
		</div>
	</div>`

	const days = [...blocksByDay(segments, online)].toSorted((a, b) => b[0] - a[0])
	const rerender = () => render(body, segments, online, expanded)

	for (const [day, blocks] of days) {
		timeline.append(dayRow(segments, online, day, blocks, expanded, rerender))
	}

	if (!days.length) {
		timeline.replaceChildren(html`<p class="btr-activity-empty">Not seen online yet.</p>`)
	}

	body.replaceChildren(summary, timeline)
}

let modal: HTMLElement | null = null

/** `isOnline` is asked again on every change, as the profile keeps it current. */
export const openActivity = async (userId: number, name: string, isOnline: () => boolean): Promise<void> => {
	modal?.remove()

	const opener = document.activeElement as HTMLElement | null
	const root = html`<div class="btr-settings-modal btr-activity-modal">
		<div class="btr-activity" role="dialog" aria-modal="true" aria-labelledby="btr-activity-title">
			<header class="btr-activity-header">
				<div>
					<h2 id="btr-activity-title" class="btr-activity-title">Activity</h2>
					<div class="btr-activity-subtitle">${name}</div>
				</div>
				<button
					type="button"
					class="btr-settings-icon-button btr-activity-close"
					aria-label="Close"
					title="Close"
				>
					<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
						<path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>
			<div class="btr-activity-body"></div>
		</div>
	</div>`

	modal = root

	// Matches the page's theme, as the settings panel does.
	root.classList.toggle("btr-dark-theme", !!document.querySelector(".dark-theme:not(.btr-settings-modal)"))

	const body = root.$req(".btr-activity-body")
	const segments = await getPresenceHistory(userId)

	// The latest day starts open, the rest wait for a click.
	const latest = Math.max(...blocksByDay(segments, isOnline()).keys())
	const expanded = new Set(Number.isFinite(latest) ? [latest] : [])

	render(body, segments, isOnline(), expanded)
	const stopWatching = onPresenceHistoryChange(userId, (changed) =>
		render(body, changed, isOnline(), expanded),
	)

	const close = () => {
		if (modal !== root) {
			return
		}

		modal = null
		stopWatching()
		root.classList.remove("btr-settings-open")
		document.removeEventListener("keydown", onKey, true)
		setTimeout(() => root.remove(), 320)
		opener?.focus()
	}

	const onKey = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") {
			ev.stopPropagation()
			close()
		}
	}

	document.addEventListener("keydown", onKey, true)
	root.$req(".btr-activity-close").$on("click", close)
	root.$on("click", (ev: MouseEvent) => {
		if (ev.target === root) {
			close()
		}
	})

	document.body.append(root)
	root.$req<HTMLElement>(".btr-activity-close").focus()

	// A later frame than the mount, or there is no start to transition from.
	requestAnimationFrame(() => root.classList.add("btr-settings-open"))
}
