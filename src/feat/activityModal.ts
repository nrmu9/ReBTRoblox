import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import { getActivityEvents, getUserNames } from "@/feat/activityData"
import type { ActivityEvent } from "@/feat/activityStore"
import { SETTINGS } from "@/feat/settings"
import {
	getPlayedTogether,
	getPresenceHistory,
	onActivityChange,
	type PresenceSegment,
} from "@/feat/presenceHistory"

// Sightings of the same state closer together than this read as one stretch.
// Pages only check now and then, so someone online all afternoon is seen every
// quarter hour or so, which would otherwise list each sighting on its own.
const JOIN_GAP = 30 * 60e3

/**
 * The history as it reads: back to back sightings of the same state joined
 * into one, and who played along moved to the joined start.
 */
const joinSightings = (segments: PresenceSegment[], together: Together) => {
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

const loadTogether = async (userId: number): Promise<Together> => {
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

	// The year only once it is not this one.
	return new Date(day).$format(
		new Date(day).getFullYear() === new Date().getFullYear() ? "DDD, MMM D" : "DDD, MMM D, YYYY",
	)
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

// Long histories are built a page at a time, so a year of it opens as fast
// as a week.
const PAGE_DAYS = 30
const PAGE_ROWS = 150
const shownDays = new WeakMap<HTMLElement, number>()

const showMore = (label: string, onClick: () => void) => {
	const button = html`<button type="button" class="btr-activity-more">${label}</button>`
	button.$on("click", onClick)
	return button
}

/** A day heading in a log, a quiet label with a rule after it. */
const dayHeading = (day: number) => html`<h3 class="btr-log-day">${dayLabel(day)}</h3>`

/** `intro` plays the opening animation, which live updates skip. */
const render = (
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

// Friends

// Images found once stay found, so a log built again shows them at once.
const imageCache = new Map<string, string>()

/** Thumbnail urls for ids of one kind, asked for 100 at a time and cached. */
const thumbnails = async (kind: "headshot" | "badge" | "place", ids: number[]) => {
	const missing = [...new Set(ids)].filter((id) => !imageCache.has(`${kind}:${id}`))
	const url =
		kind === "headshot"
			? (batch: number[]) =>
					`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${batch.join(",")}&size=48x48&format=Png&isCircular=true`
			: kind === "badge"
				? (batch: number[]) =>
						`https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${batch.join(",")}&size=150x150&format=Png`
				: (batch: number[]) =>
						`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${batch.join(",")}&size=50x50&format=Png`

	for (let i = 0; i < missing.length; i += 100) {
		const json = await fetch(url(missing.slice(i, i + 100)))
			.then((res) => res.json())
			.catch(() => null)

		for (const item of json?.data ?? []) {
			if (item.imageUrl) {
				imageCache.set(`${kind}:${item.targetId}`, item.imageUrl)
			}
		}
	}

	return (id: number) => imageCache.get(`${kind}:${id}`)
}

interface LogOptions {
	panel: HTMLElement
	events: ActivityEvent[]
	/** [key, label] pairs, the first being everything. */
	groups: ReadonlyArray<readonly [string, string]>
	groupOf: (event: ActivityEvent) => string
	entry: (event: ActivityEvent) => HTMLElement
	/** Kept across rebuilds, so a live update stays on the chosen filter. */
	state: { group: string }
	/** Shown between the filters and the list. */
	intro?: HTMLElement
	/** Hides filters with nothing in them. */
	hideEmpty?: boolean
	/** Called with each page of entries once they are in the page. */
	onPage?: (entries: HTMLElement[]) => void
}

/**
 * A log of events by day, built a page at a time. Filters only show and hide
 * what is built, so switching between them never reloads or redraws it.
 */
const buildLog = (options: LogOptions) => {
	const { panel, events, groups, groupOf, entry, state } = options
	const toolbar = html`<div class="btr-friendlog-filters" role="group" aria-label="Show"></div>`
	const list = html`<div class="btr-log"></div>`
	const empty = html`<p class="btr-activity-empty" hidden>Nothing here yet.</p>`
	const more = html<HTMLButtonElement>`<button type="button" class="btr-activity-more">Show more</button>`
	const chips: HTMLElement[] = []
	let built = 0
	let lastDay = -1

	const matches = (group: string) => state.group === groups[0][0] || group === state.group

	const appendPage = () => {
		const page = events.slice(built, built + PAGE_ROWS)
		const entries: HTMLElement[] = []

		for (const event of page) {
			const day = startOfDay(event.at)

			if (day !== lastDay) {
				lastDay = day
				list.append(dayHeading(day))
			}

			const element = entry(event)
			element.dataset.group = groupOf(event)
			entries.push(element)
			list.append(element)
		}

		built += page.length
		options.onPage?.(entries)
	}

	const apply = () => {
		// A filter with nothing built yet loads on until it has something.
		while (built < events.length && !events.slice(0, built).some((event) => matches(groupOf(event)))) {
			appendPage()
		}

		let heading: HTMLElement | null = null
		let headingShown = false
		let anyShown = false

		for (const child of list.children as HTMLCollectionOf<HTMLElement>) {
			if (child.classList.contains("btr-log-day")) {
				if (heading) {
					heading.hidden = !headingShown
				}
				heading = child
				headingShown = false
			} else {
				child.hidden = !matches(child.dataset.group ?? "")
				headingShown ||= !child.hidden
				anyShown ||= !child.hidden
			}
		}

		if (heading) {
			heading.hidden = !headingShown
		}

		for (const chip of chips) {
			chip.setAttribute("aria-pressed", String(chip.dataset.group === state.group))
		}

		empty.hidden = anyShown
		more.hidden = built >= events.length
		more.textContent = `Show more (${events.length - built})`
	}

	for (const [group, label] of groups) {
		const count =
			group === groups[0][0] ? events.length : events.filter((event) => groupOf(event) === group).length

		if (options.hideEmpty && group !== groups[0][0] && !count) {
			continue
		}

		const chip = html`<button type="button" class="btr-friendlog-filter" data-group="${group}">
			${label} <span>${count}</span>
		</button>`

		chip.$on("click", () => {
			state.group = group
			apply()
		})

		chips.push(chip)
		toolbar.append(chip)
	}

	more.$on("click", () => {
		appendPage()
		apply()
	})

	appendPage()
	apply()
	panel.replaceChildren(toolbar, ...(options.intro ? [options.intro] : []), list, empty, more)
}

const FRIEND_GROUPS = [
	["all", "All"],
	["friendAdded", "Added"],
	["friendRemoved", "Removed"],
] as const

const friendEntry = (event: ActivityEvent) => {
	const row = html`<a
		class="btr-friendlog-row"
		href="/users/${event.otherId}/profile"
		data-kind="${event.kind}"
	>
		<img class="btr-friendlog-avatar" alt="" data-user="${event.otherId}" />
		<span class="btr-friendlog-names">
			<span class="btr-friendlog-name"
				>${event.displayName || event.name || `User ${event.otherId}`}</span
			>
			<span class="btr-friendlog-username">${event.name ? `@${event.name}` : ""}</span>
		</span>
		<span class="btr-friendlog-kind">${event.kind === "friendAdded" ? "Added" : "Removed"}</span>
		<span class="btr-friendlog-time">${new Date(event.at).$format(clockFormat())}</span>
	</a>`

	// Found by comparing lists, so it happened some time before this.
	if (!event.exact) {
		row.$req(".btr-friendlog-time").title = "Noticed at this time"
	}

	return row
}

/** A friends list's changes, newest first under a heading for each day. */
const renderFriends = async (
	panel: HTMLElement,
	userId: number,
	isOwn: boolean,
	state: { group: string },
) => {
	const events = (await getActivityEvents(userId, ["friendAdded", "friendRemoved"])) ?? []

	if (!events.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				${
					isOwn
						? "No changes yet. Friends you add or lose from now on show up here."
						: "No changes to their friends recorded yet."
				}
			</p>`,
		)
		return
	}

	buildLog({
		panel,
		events,
		groups: FRIEND_GROUPS,
		groupOf: (event) => event.kind,
		entry: friendEntry,
		state,
		onPage: async (entries) => {
			const images = entries.map((row) => row.$req<HTMLImageElement>(".btr-friendlog-avatar"))
			const urlOf = await thumbnails(
				"headshot",
				images.map((img) => Number(img.dataset.user)),
			)

			for (const img of images) {
				const url = urlOf(Number(img.dataset.user))
				if (url) {
					img.src = url
				}
			}
		},
	})
}

// Profile changes

const ICONS: Record<string, string> = {
	names: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z",
	bio: "M5 7h14M5 12h14M5 17h9",
	avatar: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 4-6 8-6s8 2 8 6",
	joined: "M12 5v14M5 12h14",
	left: "M5 12h14",
	account: "M12 7v6M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
	badges: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
}

const CHANGE_GROUPS = [
	["all", "All"],
	["names", "Names"],
	["bio", "Bio"],
	["avatar", "Avatar"],
	["communities", "Communities"],
	["badges", "Badges"],
	["account", "Account"],
] as const

const groupOf = (event: ActivityEvent) =>
	event.field === "name" || event.field === "displayName"
		? "names"
		: event.field === "description"
			? "bio"
			: event.field === "avatar"
				? "avatar"
				: event.field === "groupJoined" || event.field === "groupLeft"
					? "communities"
					: event.field === "badge"
						? "badges"
						: "account"

const icon = (name: string) =>
	html`<span class="btr-change-icon" data-icon="${name}" aria-hidden="true">
		<svg viewBox="0 0 24 24" width="16" height="16">
			<path
				d="${ICONS[name]}"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</span>`

/** "old → new", for a name. */
const swap = (before: unknown, after: unknown) => {
	const line = html`<div class="btr-change-swap">
		<span class="btr-change-old"></span>
		<span aria-label="changed to">→</span>
		<span class="btr-change-new"></span>
	</div>`

	line.$req(".btr-change-old").textContent = String(before ?? "")
	line.$req(".btr-change-new").textContent = String(after ?? "")
	return line
}

const changeEntry = (event: ActivityEvent) => {
	const group = groupOf(event)
	const iconName = event.field === "groupJoined" ? "joined" : event.field === "groupLeft" ? "left" : group

	const item = html`<div class="btr-change" data-icon="${iconName}">
		<div class="btr-change-body">
			<div class="btr-change-title"></div>
		</div>
		<span class="btr-change-time">${new Date(event.at).$format(clockFormat())}</span>
	</div>`

	item.prepend(icon(iconName))

	const title = item.$req(".btr-change-title")
	const body = item.$req(".btr-change-body")

	if (event.field === "name") {
		title.textContent = "Username changed"
		body.append(swap(`@${event.before}`, `@${event.after}`))
	} else if (event.field === "displayName") {
		title.textContent = "Display name changed"
		body.append(swap(event.before, event.after))
	} else if (event.field === "description") {
		title.textContent = event.after ? "Bio changed" : "Bio cleared"

		const details = html`<details class="btr-change-details">
			<summary>Compare</summary>
			<div class="btr-change-before"></div>
			<div class="btr-change-after"></div>
		</details>`

		details.$req(".btr-change-before").textContent = String(event.before || "(empty)")
		details.$req(".btr-change-after").textContent = String(event.after || "(empty)")
		body.append(details)
	} else if (event.field === "avatar") {
		title.textContent = "Avatar changed"

		const images = html`<div class="btr-change-avatars">
			<figure>
				<img alt="" src="${event.before}" />
				<figcaption>Before</figcaption>
			</figure>
			<span aria-hidden="true">→</span>
			<figure>
				<img alt="" src="${event.after}" />
				<figcaption>After</figcaption>
			</figure>
		</div>`

		// Roblox keeps these images for 30 days.
		for (const img of images.$findAll<HTMLImageElement>("img")) {
			img.$on("error", () => img.closest("figure")?.classList.add("btr-change-expired"))
		}

		body.append(images)
	} else if (event.field === "groupJoined" || event.field === "groupLeft") {
		const { id, name } = (event.field === "groupJoined" ? event.after : event.before) as {
			id: number
			name: string
		}

		title.append(
			event.field === "groupJoined" ? "Joined " : "Left ",
			html`<a href="/communities/${id}">${name}</a>`,
		)
	} else if (event.field === "badge") {
		const badge = event.after as { id: number; name: string; placeId?: number; gameName?: string }

		title.append("Earned ", html`<a href="/badges/${badge.id}">${badge.name}</a>`)

		if (badge.placeId) {
			const game = html`<div class="btr-change-sub"></div>`
			game.append("in ")
			game.append(html`<a href="/games/${badge.placeId}">${badge.gameName || "an experience"}</a>`)
			body.append(game)
		}

		item.dataset.badge = String(badge.id)
	} else if (event.field === "isBanned") {
		title.textContent = event.after ? "Account banned" : "Account unbanned"
	} else {
		title.textContent = `${event.field} changed`
	}

	return item
}

/** What changed on someone's profile, newest first by day, filtered by kind of change. */
const renderChanges = async (panel: HTMLElement, userId: number, state: { group: string }) => {
	const events = (await getActivityEvents(userId, ["profileChanged"])) ?? []

	if (!events.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				No changes yet. Their names, bio, avatar, communities and badges are checked every few hours.
			</p>`,
		)
		return
	}

	buildLog({
		panel,
		events,
		groups: CHANGE_GROUPS,
		groupOf,
		entry: changeEntry,
		state,
		hideEmpty: true,
		intro: html`<p class="btr-change-note">
			Profiles are checked every few hours, so most changes happened some time before the time shown.
			Badges show when they were earned.
		</p>`,
		onPage: async (entries) => {
			const badges = entries.filter((item) => item.dataset.badge)
			const urlOf = await thumbnails(
				"badge",
				badges.map((item) => Number(item.dataset.badge)),
			)

			for (const item of badges) {
				const url = urlOf(Number(item.dataset.badge))

				if (url) {
					item.$find(".btr-change-icon")?.replaceWith(
						html`<img class="btr-change-badge" alt="" src="${url}" />`,
					)
				}
			}
		},
	})
}

// Watching

const watchedList = (): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get("profile.watchedUsers") || "[]")
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

export const isWatched = (userId: number): boolean => watchedList().includes(userId)

export const setWatched = (userId: number, watched: boolean): void => {
	const list = watchedList().filter((id) => id !== userId)
	SETTINGS.set("profile.watchedUsers", JSON.stringify(watched ? [...list, userId] : list))
}

// Stats

interface GameTime {
	name: string
	placeId?: number
	time: number
	sessions: number
}

interface Session {
	from: number
	to: number
	/** Time in each game during it, by name. */
	games: Map<string, number>
}

// Switching games shows as a moment offline, so a session only ends at a
// longer break than that.
const SESSION_BREAK = 10 * 60e3

/**
 * Totals from `since` on: time online and in experiences, the days with any,
 * time per game, and sessions, each running until a break from playing.
 */
const statsSince = (segments: PresenceSegment[], online: boolean, since: number) => {
	let onlineTime = 0
	let gameTime = 0
	const days = new Set<number>()
	const games = new Map<string, GameTime>()
	const sessions: Session[] = []
	let session: Session | null = null

	segments.forEach((segment, index) => {
		if (segment.type === 0) {
			return
		}

		const start = Math.max(segment.from, since)
		const end = segmentEnd(segments, index, online)

		if (end <= start) {
			return
		}

		const time = end - start
		onlineTime += time

		for (let day = startOfDay(start); day < end; day = nextDay(day)) {
			days.add(day)
		}

		const gameName = segment.type === 2 ? (segment.location ?? "Hidden experience") : null

		if (gameName) {
			gameTime += time
			const key = segment.placeId ? String(segment.placeId) : gameName
			const game = games.get(key) ?? {
				name: gameName,
				...(segment.placeId ? { placeId: segment.placeId } : {}),
				time: 0,
				sessions: 0,
			}
			game.time += time
			game.sessions++
			games.set(key, game)
		}

		if (!session || start - session.to >= SESSION_BREAK) {
			session = { from: start, to: end, games: new Map() }
			sessions.push(session)
		} else {
			session.to = Math.max(session.to, end)
		}

		if (gameName) {
			session.games.set(gameName, (session.games.get(gameName) ?? 0) + time)
		}
	})

	return {
		onlineTime,
		gameTime,
		days: days.size,
		games: [...games.values()].toSorted((a, b) => b.time - a.time),
		sessions: sessions.toSorted((a, b) => b.to - b.from - (a.to - a.from)),
	}
}

const STAT_PERIODS = [
	["7", "7 days"],
	["30", "30 days"],
	["all", "All time"],
] as const

const statCard = (label: string, value: string, detail = "") =>
	html`<div class="btr-activity-stat">
		<div class="btr-activity-stat-label">${label}</div>
		<div class="btr-activity-stat-value">${value}</div>
		<div class="btr-activity-stat-detail">${detail}</div>
	</div>`

const statsSection = (segments: PresenceSegment[], online: boolean, since: number) => {
	const stats = statsSince(segments, online, since)
	const section = html`<div class="btr-stats"></div>`

	if (!stats.onlineTime) {
		section.append(html`<p class="btr-activity-empty">Not seen online in this time.</p>`)
		return section
	}

	const longest = stats.sessions[0]

	section.append(
		html`<div class="btr-activity-summary btr-stats-cards"></div>`,
		html`<h3 class="btr-stats-heading">Most played</h3>`,
		html`<div class="btr-stats-games"></div>`,
		html`<h3 class="btr-stats-heading">Longest sessions</h3>`,
		html`<div class="btr-stats-sessions"></div>`,
	)

	section
		.$req(".btr-stats-cards")
		.append(
			statCard("Online", formatDuration(stats.onlineTime)),
			statCard("In experiences", formatDuration(stats.gameTime)),
			statCard("Days active", String(stats.days)),
			statCard(
				"Longest session",
				formatDuration(longest.to - longest.from),
				new Date(longest.from).$format("MMM D"),
			),
		)

	const gameList = section.$req(".btr-stats-games")
	const top = stats.games[0]?.time ?? 1

	for (const game of stats.games.slice(0, 10)) {
		const row = html`<div class="btr-stats-game">
			<span class="btr-stats-game-icon" data-place="${game.placeId ?? ""}"></span>
			<div class="btr-stats-game-text">
				<div class="btr-stats-game-line">
					<span class="btr-stats-game-name"></span>
					<span class="btr-stats-game-time">${formatDuration(game.time)}</span>
				</div>
				<div class="btr-stats-bar"><span></span></div>
				<div class="btr-stats-game-sessions">
					${game.sessions === 1 ? "1 session" : `${game.sessions} sessions`}
				</div>
			</div>
		</div>`

		row.$req(".btr-stats-game-name").append(
			game.placeId ? html`<a href="/games/${game.placeId}">${game.name}</a>` : game.name,
		)
		row.$req<HTMLElement>(".btr-stats-bar > span").style.width = `${(game.time / top) * 100}%`
		gameList.append(row)
	}

	if (!stats.games.length) {
		gameList.append(html`<p class="btr-stats-none">No time in experiences.</p>`)
	}

	const sessionList = section.$req(".btr-stats-sessions")

	for (const session of stats.sessions.slice(0, 5)) {
		const main = [...session.games].toSorted((a, b) => b[1] - a[1])[0]?.[0]

		sessionList.append(
			html`<div class="btr-stats-session">
				<span class="btr-stats-session-length">${formatDuration(session.to - session.from)}</span>
				<span class="btr-stats-session-what">${main ? `Mostly ${main}` : "On the website"}</span>
				<span class="btr-stats-session-when"
					>${new Date(session.from).$format(`MMM D, ${clockFormat()}`)}</span
				>
			</div>`,
		)
	}

	return section
}

/** Stats for each period, all built at once so switching between them is instant. */
const renderStats = async (
	panel: HTMLElement,
	segments: PresenceSegment[],
	online: boolean,
	state: { period: string },
) => {
	const toolbar = html`<div class="btr-friendlog-filters" role="group" aria-label="Period"></div>`
	const sections = new Map<string, HTMLElement>()

	for (const [period, label] of STAT_PERIODS) {
		const since = period === "all" ? 0 : Date.now() - Number(period) * DAY
		const section = statsSection(segments, online, since)
		section.dataset.period = period
		sections.set(period, section)

		const chip = html`<button type="button" class="btr-friendlog-filter" data-period="${period}">
			${label}
		</button>`

		chip.$on("click", () => {
			state.period = period
			show()
		})

		toolbar.append(chip)
	}

	const show = () => {
		for (const [period, section] of sections) {
			section.hidden = period !== state.period
		}

		for (const chip of toolbar.$findAll<HTMLElement>("[data-period]")) {
			chip.setAttribute("aria-pressed", String(chip.dataset.period === state.period))
		}
	}

	show()
	panel.replaceChildren(toolbar, ...sections.values())

	const icons = [...panel.$findAll<HTMLElement>(".btr-stats-game-icon")]
	const urlOf = await thumbnails("place", icons.map((icon) => Number(icon.dataset.place)).filter(Boolean))

	for (const icon of icons) {
		const url = urlOf(Number(icon.dataset.place))

		if (url) {
			icon.append(html`<img alt="" src="${url}" />`)
		}
	}
}

// The dialog

let modal: HTMLElement | null = null

type Tab = "activity" | "stats" | "friends" | "changes"

/**
 * Someone's activity, over the page. `isOnline` is asked again on every
 * change, as the profile keeps it current.
 */
export const openActivity = async (
	userId: number,
	name: string,
	isOnline: () => boolean,
	options: { tab?: Tab; isOwn?: boolean } = {},
): Promise<void> => {
	modal?.remove()

	const opener = document.activeElement as HTMLElement | null
	const root = html`<div class="btr-settings-modal btr-activity-modal">
		<div class="btr-activity" role="dialog" aria-modal="true" aria-labelledby="btr-activity-title">
			<header class="btr-activity-header">
				<div>
					<h2 id="btr-activity-title" class="btr-activity-title">Activity</h2>
					<div class="btr-activity-subtitle">${name}</div>
				</div>
				<button type="button" class="btr-activity-watch" aria-pressed="false" hidden></button>
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
			<div class="btr-activity-tabs" role="tablist" hidden>
				<button type="button" role="tab" data-tab="activity">Activity</button>
				<button type="button" role="tab" data-tab="stats">Stats</button>
				<button type="button" role="tab" data-tab="friends">Friends</button>
				<button type="button" role="tab" data-tab="changes">Changes</button>
			</div>
			<div class="btr-activity-body">
				<div class="btr-activity-panel" data-tab="activity" role="tabpanel"></div>
				<div class="btr-activity-panel" data-tab="stats" role="tabpanel"></div>
				<div class="btr-activity-panel" data-tab="friends" role="tabpanel"></div>
				<div class="btr-activity-panel" data-tab="changes" role="tabpanel"></div>
			</div>
		</div>
	</div>`

	modal = root

	// Matches the page's theme, as the settings panel does.
	root.classList.toggle("btr-dark-theme", !!document.querySelector(".dark-theme:not(.btr-settings-modal)"))

	const body = root.$req(".btr-activity-body")
	const activityPanel = body.$req('[data-tab="activity"]')
	const statsPanel = body.$req('[data-tab="stats"]')
	const statsState = { period: "30" }
	const friendsPanel = body.$req('[data-tab="friends"]')
	const changesPanel = body.$req('[data-tab="changes"]')
	const friendFilter = { group: "all" }
	const changeFilter = { group: "all" }

	const [history, playedTogether, events] = await Promise.all([
		getPresenceHistory(userId),
		loadTogether(userId),
		options.isOwn ? Promise.resolve(null) : getActivityEvents(userId),
	])
	const { segments, together } = joinSightings(history, playedTogether)
	// What the stats are worked out from, kept current by live changes.
	let shown = segments

	// The latest day starts open, the rest wait for a click.
	const latest = Math.max(...blocksByDay(segments, isOnline()).keys())
	const expanded = new Set(Number.isFinite(latest) ? [latest] : [])

	render(activityPanel, segments, isOnline(), together, expanded, true)

	// Friends shows for your own list and for people watched now or before,
	// Changes for people watched now or before.
	const tabs = root.$req(".btr-activity-tabs")
	const friendsTab = tabs.$req('[data-tab="friends"]')
	const changesTab = tabs.$req('[data-tab="changes"]')

	const updateTabs = () => {
		const watched = !options.isOwn && isWatched(userId)
		friendsTab.hidden =
			!options.isOwn && !watched && !events?.some((event) => event.kind !== "profileChanged")
		changesTab.hidden = !watched && !events?.some((event) => event.kind === "profileChanged")
		tabs.hidden = false
	}

	updateTabs()

	// Watching anyone but yourself.
	const watch = root.$req<HTMLButtonElement>(".btr-activity-watch")

	if (!options.isOwn) {
		const updateWatch = () => {
			const watched = isWatched(userId)
			watch.setAttribute("aria-pressed", String(watched))
			watch.textContent = watched ? "Watching" : "Watch"
			watch.title = watched
				? "Stop checking on them"
				: "Checks where they are, their friends and their profile from the background"
		}

		watch.hidden = false
		watch.$on("click", () => setWatched(userId, !isWatched(userId)))
		// Settings listeners stay for good, so a closed dialog ignores them.
		SETTINGS.onChange("profile.watchedUsers", () => {
			if (modal === root) {
				updateWatch()
				updateTabs()
			}
		})
		updateWatch()
	}

	const selectTab = (tab: Tab) => {
		for (const button of tabs.$findAll<HTMLElement>("[data-tab]")) {
			const selected = button.dataset.tab === tab
			button.setAttribute("aria-selected", String(selected))
			button.tabIndex = selected ? 0 : -1
		}

		for (const panel of body.$findAll<HTMLElement>(".btr-activity-panel")) {
			panel.hidden = panel.dataset.tab !== tab
		}

		if (tab === "stats" && !statsPanel.childElementCount) {
			void renderStats(statsPanel, shown, isOnline(), statsState)
		} else if (tab === "friends" && !friendsPanel.childElementCount) {
			void renderFriends(friendsPanel, userId, !!options.isOwn, friendFilter)
		} else if (tab === "changes" && !changesPanel.childElementCount) {
			void renderChanges(changesPanel, userId, changeFilter)
		}
	}

	for (const button of tabs.$findAll<HTMLElement>("[data-tab]")) {
		button.$on("click", () => selectTab(button.dataset.tab as Tab))
	}

	selectTab(tabs.hidden ? "activity" : (options.tab ?? "activity"))

	const stopWatching = onActivityChange([userId], async () => {
		const joined = joinSightings(
			...(await Promise.all([getPresenceHistory(userId), loadTogether(userId)])),
		)
		render(activityPanel, joined.segments, isOnline(), joined.together, expanded)
		shown = joined.segments

		if (statsPanel.childElementCount) {
			void renderStats(statsPanel, shown, isOnline(), statsState)
		}

		if (friendsPanel.childElementCount) {
			void renderFriends(friendsPanel, userId, !!options.isOwn, friendFilter)
		}

		if (changesPanel.childElementCount) {
			void renderChanges(changesPanel, userId, changeFilter)
		}
	})

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
