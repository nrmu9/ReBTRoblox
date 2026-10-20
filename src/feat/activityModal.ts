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

	if (segment.type === 0 || (!current && end - segment.from < 60e3)) {
		when.textContent = from.$format(clockFormat())
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

const headshots = async (userIds: number[]) => {
	const urls = new Map<number, string>()

	for (let i = 0; i < userIds.length; i += 100) {
		const json = await fetch(
			`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.slice(i, i + 100).join(",")}&size=48x48&format=Png&isCircular=true`,
		)
			.then((res) => res.json())
			.catch(() => null)

		for (const item of json?.data ?? []) {
			if (item.imageUrl) {
				urls.set(item.targetId, item.imageUrl)
			}
		}
	}

	return urls
}

const FILTERS = [
	["all", "All"],
	["friendAdded", "Added"],
	["friendRemoved", "Removed"],
] as const

/** A friends list's changes, newest first under a heading for each day. */
const renderFriends = async (
	panel: HTMLElement,
	userId: number,
	isOwn: boolean,
	filter: { kind: string; limit?: number },
) => {
	const events = (await getActivityEvents(userId, ["friendAdded", "friendRemoved"])) ?? []
	const matching = events.filter((event) => filter.kind === "all" || event.kind === filter.kind)
	const shown = matching.slice(0, filter.limit ?? PAGE_ROWS)

	const toolbar = html`<div class="btr-friendlog-filters" role="group" aria-label="Show"></div>`

	for (const [kind, label] of FILTERS) {
		const count = kind === "all" ? events.length : events.filter((event) => event.kind === kind).length
		const button = html`<button
			type="button"
			class="btr-friendlog-filter"
			aria-pressed="${filter.kind === kind}"
		>
			${label} <span>${count}</span>
		</button>`

		button.$on("click", () => {
			filter.kind = kind
			filter.limit = PAGE_ROWS
			void renderFriends(panel, userId, isOwn, filter)
		})

		toolbar.append(button)
	}

	const list = html`<div class="btr-friendlog"></div>`
	let day = -1

	for (const event of shown) {
		const eventDay = startOfDay(event.at)

		if (eventDay !== day) {
			day = eventDay
			list.append(dayHeading(day))
		}

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

		list.append(row)
	}

	if (matching.length > shown.length) {
		list.append(
			showMore(`Show more (${matching.length - shown.length})`, () => {
				filter.limit = shown.length + PAGE_ROWS
				void renderFriends(panel, userId, isOwn, filter)
			}),
		)
	}

	if (!shown.length) {
		list.append(
			html`<p class="btr-activity-empty">
				${
					events.length
						? "Nothing here with this filter."
						: isOwn
							? "No changes yet. Friends you add or lose from now on show up here."
							: "No changes to their friends recorded yet."
				}
			</p>`,
		)
	}

	panel.replaceChildren(toolbar, list)

	const ids = [...new Set(shown.map((event) => event.otherId!))]
	const urls = await headshots(ids)

	for (const img of list.$findAll<HTMLImageElement>(".btr-friendlog-avatar")) {
		const url = urls.get(Number(img.dataset.user))
		if (url) {
			img.src = url
		}
	}
}

// Profile changes

const ICONS: Record<string, string> = {
	names: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z",
	bio: "M5 7h14M5 12h14M5 17h9",
	avatar: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 4-6 8-6s8 2 8 6",
	joined: "M12 5v14M5 12h14",
	left: "M5 12h14",
	account: "M12 7v6M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
}

const CHANGE_GROUPS = [
	["all", "All"],
	["names", "Names"],
	["bio", "Bio"],
	["avatar", "Avatar"],
	["communities", "Communities"],
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

	const item = html`<li class="btr-change" data-icon="${iconName}">
		<div class="btr-change-body">
			<div class="btr-change-title"></div>
		</div>
		<span class="btr-change-time">${new Date(event.at).$format(clockFormat())}</span>
	</li>`

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
	} else if (event.field === "isBanned") {
		title.textContent = event.after ? "Account banned" : "Account unbanned"
	} else {
		title.textContent = `${event.field} changed`
	}

	return item
}

/** What changed on someone's profile, newest first by day, filtered by kind of change. */
const renderChanges = async (
	panel: HTMLElement,
	userId: number,
	filter: { group: string; limit?: number },
) => {
	const events = (await getActivityEvents(userId, ["profileChanged"])) ?? []
	const matching = events.filter((event) => filter.group === "all" || groupOf(event) === filter.group)
	const shown = matching.slice(0, filter.limit ?? PAGE_ROWS)

	// Only the kinds of change that happened get a chip, besides All.
	const toolbar = html`<div class="btr-friendlog-filters" role="group" aria-label="Show"></div>`

	for (const [group, label] of CHANGE_GROUPS) {
		const count =
			group === "all" ? events.length : events.filter((event) => groupOf(event) === group).length

		if (group !== "all" && !count) {
			continue
		}

		const button = html`<button
			type="button"
			class="btr-friendlog-filter"
			aria-pressed="${filter.group === group}"
		>
			${label} <span>${count}</span>
		</button>`

		button.$on("click", () => {
			filter.group = group
			filter.limit = PAGE_ROWS
			void renderChanges(panel, userId, filter)
		})

		toolbar.append(button)
	}

	const note = html`<p class="btr-change-note">
		Profiles are checked every few hours, so each change happened some time before the time shown.
	</p>`

	const list = html`<ol class="btr-change-list"></ol>`
	let day = -1

	for (const event of shown) {
		const eventDay = startOfDay(event.at)

		if (eventDay !== day) {
			day = eventDay
			list.append(html`<li class="btr-change-day"></li>`)
			list.lastElementChild!.append(dayHeading(day))
		}

		list.append(changeEntry(event))
	}

	if (matching.length > shown.length) {
		list.append(
			showMore(`Show more (${matching.length - shown.length})`, () => {
				filter.limit = shown.length + PAGE_ROWS
				void renderChanges(panel, userId, filter)
			}),
		)
	}

	if (!events.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				No changes yet. Their names, bio, avatar and communities are checked every few hours.
			</p>`,
		)
		return
	}

	panel.replaceChildren(toolbar, note, list)
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

// The dialog

let modal: HTMLElement | null = null

type Tab = "activity" | "friends" | "changes"

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
				<button type="button" role="tab" data-tab="friends">Friends</button>
				<button type="button" role="tab" data-tab="changes">Changes</button>
			</div>
			<div class="btr-activity-body">
				<div class="btr-activity-panel" data-tab="activity" role="tabpanel"></div>
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
	const friendsPanel = body.$req('[data-tab="friends"]')
	const changesPanel = body.$req('[data-tab="changes"]')
	const friendFilter = { kind: "all" }
	const changeFilter = { group: "all" }

	const [segments, together, events] = await Promise.all([
		getPresenceHistory(userId),
		loadTogether(userId),
		options.isOwn ? Promise.resolve(null) : getActivityEvents(userId),
	])

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
		tabs.hidden = friendsTab.hidden && changesTab.hidden
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

		if (tab === "friends" && !friendsPanel.childElementCount) {
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
		const [changed, changedTogether] = await Promise.all([
			getPresenceHistory(userId),
			loadTogether(userId),
		])
		render(activityPanel, changed, isOnline(), changedTogether, expanded)

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
