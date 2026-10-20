import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import { getUserNames } from "@/feat/activity/data"
import { getPlayedTogether, type PresenceSegment } from "@/feat/activity/presence"
import {
	JOIN_GAP,
	DAY,
	segmentEnd,
	lastSeenAt,
	formatDuration,
	onlineSince,
	startOfDay,
	nextDay,
	dayLabel,
	PAGE_DAYS,
	shownDays,
	showMore,
} from "@/feat/activity/shared"

// The Activity tab: a bar across each day's 24 hours, and the day's details.

/**
 * The history as it reads: back to back sightings of the same state joined
 * into one, and who played along moved to the joined start.
 */
export const joinSightings = (segments: PresenceSegment[], together: Together) => {
	const joined: PresenceSegment[] = []
	const startOf = new Map<number, number>()

	for (const segment of segments) {
		const last = joined.at(-1)

		if (
			last &&
			last.type === segment.type &&
			last.location === segment.location &&
			last.placeId === segment.placeId &&
			segment.type !== 0 &&
			segment.from - last.to < JOIN_GAP
		) {
			last.to = Math.max(last.to, segment.to)
			startOf.set(segment.from, last.from)
		} else {
			joined.push({ ...segment })
			startOf.set(segment.from, segment.from)
		}
	}

	const joinedTogether: Together = new Map()

	for (const [from, people] of together) {
		const start = startOf.get(from) ?? from
		const all = [...(joinedTogether.get(start) ?? []), ...people]
		joinedTogether.set(start, [...new Map(all.map((person) => [person.userId, person])).values()])
	}

	return { segments: joined, together: joinedTogether }
}

/** The people a session was shared with, by the session's start. */
type Together = Map<number, Array<{ userId: number; name: string }>>

export const loadTogether = async (userId: number): Promise<Together> => {
	const together = await getPlayedTogether(userId)
	const ids = [...new Set(Object.values(together).flatMap((others) => others.map((other) => other.userId)))]
	const names = ids.length ? await getUserNames(ids) : new Map()
	const result: Together = new Map()

	for (const [from, others] of Object.entries(together)) {
		const people = new Map(
			others.map((other) => [
				other.userId,
				{
					userId: other.userId,
					name: names.get(other.userId)?.displayName ?? `User ${other.userId}`,
				},
			]),
		)

		result.set(Number(from), [...people.values()])
	}

	return result
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
export const blocksByDay = (segments: PresenceSegment[], online: boolean) => {
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

const entry = (segments: PresenceSegment[], index: number, online: boolean, together: Together) => {
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

	if (segment.type === 0) {
		when.textContent = from.$format(clockFormat())
	} else if (!current && end - segment.from < 60e3) {
		when.textContent = `Seen at ${from.$format(clockFormat())}`
	} else {
		const until = current ? "now" : new Date(end).$format(clockFormat())
		when.textContent = `${from.$format(clockFormat())} – ${until} · ${formatDuration(end - segment.from)}`
	}

	// Started before it was noticed, so the real start may be earlier.
	if (segment.type > 0 && !segment.exact) {
		when.title = "First seen at this time"
	}

	const people = segment.type === 2 ? together.get(segment.from) : undefined

	if (people?.length) {
		const line = html`<div class="btr-activity-with"></div>`
		line.append("With ")

		people.forEach((person, i) => {
			if (i > 0) {
				line.append(i === people.length - 1 ? " and " : ", ")
			}

			line.append(html`<a href="/users/${person.userId}/profile">${person.name}</a>`)
		})

		item.$req(".btr-activity-text").append(line)
	}

	return item
}

const dayRow = (
	segments: PresenceSegment[],
	online: boolean,
	together: Together,
	day: number,
	blocks: Block[],
	expanded: Set<number>,
) => {
	const length = nextDay(day) - day
	const total = blocks.reduce((sum, block) => sum + block.end - block.start, 0)
	const label = dayLabel(day)

	const row = html`<div class="btr-activity-day">
		<button type="button" class="btr-activity-day-row">
			<span class="btr-activity-day-label">${label}</span>
			<span class="btr-activity-bar"></span>
			<span class="btr-activity-day-total">${formatDuration(total)}</span>
			<svg class="btr-activity-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
				<path
					d="M6 9l6 6 6-6"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
		<div class="btr-activity-details">
			<div class="btr-activity-details-inner">
				<ol class="btr-activity-day-list"></ol>
			</div>
		</div>
	</div>`

	const toggle = row.$req(".btr-activity-day-row")
	const details = row.$req(".btr-activity-details")

	// Details stay in the page and fold away, so opening can animate, but
	// nothing in a folded day is reachable.
	const setOpen = (open: boolean) => {
		row.classList.toggle("btr-activity-day-open", open)
		toggle.setAttribute("aria-expanded", String(open))
		details.inert = !open
	}

	toggle.setAttribute("aria-label", `${label}, online ${formatDuration(total)}`)
	toggle.$on("click", () => {
		const open = !expanded.has(day)

		if (open) {
			expanded.add(day)
		} else {
			expanded.delete(day)
		}

		setOpen(open)
	})

	setOpen(expanded.has(day))

	const bar = row.$req(".btr-activity-bar")

	for (const block of blocks) {
		const segment = segments[block.index]
		const piece = html`<span class="btr-activity-block" data-type="${segment.type}"></span>`
		const range = `${new Date(block.start).$format(clockFormat())} – ${new Date(block.end).$format(clockFormat())}`

		piece.style.left = `${((block.start - day) / length) * 100}%`
		piece.style.width = `${((block.end - block.start) / length) * 100}%`
		piece.title = `${stateText(segment)}
${range} · ${formatDuration(block.end - block.start)}`
		bar.append(piece)
	}

	if (day === startOfDay(Date.now())) {
		const now = html`<span class="btr-activity-now"></span>`
		now.style.left = `${((Date.now() - day) / length) * 100}%`
		bar.append(now)
	}

	const list = row.$req(".btr-activity-day-list")

	for (let i = segments.length; i--;) {
		const segment = segments[i]
		const inDay =
			segment.type === 0
				? segment.from >= day && segment.from < day + length
				: blocks.some((block) => block.index === i)

		if (inDay) {
			list.append(entry(segments, i, online, together))
		}
	}

	return row
}

/** `intro` plays the opening animation, which live updates skip. */
export const render = (
	body: HTMLElement,
	segments: PresenceSegment[],
	online: boolean,
	together: Together,
	expanded: Set<number>,
	intro = false,
) => {
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
		status.title = new Date(seen).$format(`MMM D, YYYY, ${clockFormat()}`)
	} else {
		status.textContent = "Not yet"
	}

	const timeline = html`<div class="btr-activity-timeline">
		<div class="btr-activity-scale" aria-hidden="true"></div>
	</div>`

	const twelveHour = clockFormat().endsWith("A")
	timeline
		.$req(".btr-activity-scale")
		.append(
			...[0, 6, 12, 18].map(
				(hour) =>
					html`<span
						>${twelveHour ? `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}` : `${String(hour).padStart(2, "0")}:00`}</span
					>`,
			),
		)

	const days = [...blocksByDay(segments, online)].toSorted((a, b) => b[0] - a[0])
	const limit = shownDays.get(body) ?? PAGE_DAYS

	days.slice(0, limit).forEach(([day, blocks], index) => {
		const row = dayRow(segments, online, together, day, blocks, expanded)
		row.style.setProperty("--btr-index", String(index))
		timeline.append(row)
	})

	if (days.length > limit) {
		timeline.append(
			showMore(`Show earlier days (${days.length - limit} more)`, () => {
				shownDays.set(body, limit + PAGE_DAYS)
				render(body, segments, online, together, expanded)
			}),
		)
	}

	if (!days.length) {
		timeline.replaceChildren(html`<p class="btr-activity-empty">Not seen online yet.</p>`)
	}

	body.classList.toggle("btr-activity-intro", intro)
	body.replaceChildren(summary, timeline)
}
