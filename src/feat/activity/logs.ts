import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import { getActivityEvents } from "@/feat/activity/data"
import type { ActivityEvent } from "@/feat/activity/store"
import { startOfDay, PAGE_ROWS, dayHeading } from "@/feat/activity/shared"

// The Friends and Changes tabs: logs by day, filtered in place.

// Images found once stay found, so a log built again shows them at once.
const imageCache = new Map<string, string>()

/** Thumbnail urls for ids of one kind, asked for 100 at a time and cached. */
export const thumbnails = async (kind: "headshot" | "badge" | "place" | "asset", ids: number[]) => {
	const missing = [...new Set(ids)].filter((id) => !imageCache.has(`${kind}:${id}`))
	const url =
		kind === "headshot"
			? (batch: number[]) =>
					`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${batch.join(",")}&size=48x48&format=Png&isCircular=true`
			: kind === "badge"
				? (batch: number[]) =>
						`https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${batch.join(",")}&size=150x150&format=Png`
				: kind === "place"
					? (batch: number[]) =>
							`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${batch.join(",")}&size=50x50&format=Png`
					: (batch: number[]) =>
							`https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(",")}&size=150x150&format=Png`

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

const PEOPLE_GROUPS = [
	["all", "All"],
	["friends", "Friends"],
	["followers", "Followers"],
	["following", "Following"],
	["requests", "Requests"],
] as const

const PEOPLE_KINDS: ActivityEvent["kind"][] = [
	"friendAdded",
	"friendRemoved",
	"followerAdded",
	"followerRemoved",
	"followingAdded",
	"followingRemoved",
	"requestReceived",
	"requestSent",
	"requestDeclined",
]

const peopleGroup = (event: ActivityEvent) =>
	event.kind.startsWith("friend")
		? "friends"
		: event.kind.startsWith("follower")
			? "followers"
			: event.kind.startsWith("request")
				? "requests"
				: "following"

/** What happened, read after the person's name. */
const peopleLabel = ({ kind, field }: ActivityEvent, isOwn: boolean) =>
	({
		requestReceived: "Sent you a request",
		requestSent: "You sent a request",
		requestDeclined:
			field === "byYou"
				? "You declined"
				: field === "byThem"
					? "Declined your request"
					: "Request declined",
		friendAdded: "Friend added",
		friendRemoved: "Friend removed",
		followerAdded: isOwn ? "Followed you" : "Followed them",
		followerRemoved: isOwn ? "Unfollowed you" : "Unfollowed them",
		followingAdded: isOwn ? "You followed" : "They followed",
		followingRemoved: isOwn ? "You unfollowed" : "They unfollowed",
	})[kind as string] ?? kind

const friendEntry = (event: ActivityEvent, isOwn: boolean) => {
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
		<span class="btr-friendlog-kind">${peopleLabel(event, isOwn)}</span>
		<span class="btr-friendlog-time">${new Date(event.at).$format(clockFormat())}</span>
	</a>`

	// Found by comparing lists, so it happened some time before this.
	if (!event.exact) {
		row.$req(".btr-friendlog-time").title = "Noticed at this time"
	}

	return row
}

/** Friends made and lost, and followers and following gained and lost, newest first by day. */
export const renderFriends = async (
	panel: HTMLElement,
	userId: number,
	isOwn: boolean,
	state: { group: string },
) => {
	const events = (await getActivityEvents(userId, PEOPLE_KINDS)) ?? []

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
		groups: PEOPLE_GROUPS,
		hideEmpty: true,
		groupOf: peopleGroup,
		entry: (event) => friendEntry(event, isOwn),
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
	favorites: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
	followers:
		"M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .6 3 2.4 3 5",
}

const CHANGE_GROUPS = [
	["all", "All"],
	["names", "Names"],
	["bio", "Bio"],
	["avatar", "Avatar"],
	["communities", "Communities"],
	["badges", "Badges"],
	["favorites", "Favorites"],
	["followers", "Followers"],
	["account", "Account"],
] as const

const groupOf = (event: ActivityEvent) =>
	event.field === "name" || event.field === "displayName"
		? "names"
		: event.field === "description"
			? "bio"
			: event.field === "avatar"
				? "avatar"
				: event.field === "groupJoined" || event.field === "groupLeft" || event.field === "groupRole"
					? "communities"
					: event.field === "badge"
						? "badges"
						: event.field === "favoriteAdded" || event.field === "favoriteRemoved"
							? "favorites"
							: event.field === "followers" || event.field === "followings"
								? "followers"
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

		for (const [label, items] of [
			["Put on", event.items?.added],
			["Took off", event.items?.removed],
		] as const) {
			if (!items?.length) {
				continue
			}

			const line = html`<div class="btr-change-sub"></div>`
			line.append(`${label} `)

			items.forEach((piece, i) => {
				if (i > 0) {
					line.append(", ")
				}

				line.append(html`<a href="/catalog/${piece.id}">${piece.name}</a>`)
			})

			body.append(line)
		}
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
	} else if (event.field === "favoriteAdded" || event.field === "favoriteRemoved") {
		const favorite = (event.field === "favoriteAdded" ? event.after : event.before) as {
			kind: "game" | "item"
			id: number
			name: string
			placeId?: number
		}
		const href =
			favorite.kind === "game"
				? favorite.placeId
					? `/games/${favorite.placeId}`
					: null
				: `/catalog/${favorite.id}`

		title.append(
			event.field === "favoriteAdded" ? "Favorited " : "Unfavorited ",
			href ? html`<a href="${href}">${favorite.name}</a>` : favorite.name,
		)

		if (favorite.kind === "game" && favorite.placeId) {
			item.dataset.place = String(favorite.placeId)
		} else if (favorite.kind === "item") {
			item.dataset.asset = String(favorite.id)
		}
	} else if (event.field === "followers" || event.field === "followings") {
		const before = Number(event.before)
		const after = Number(event.after)
		const change = after - before

		title.textContent = `${event.field === "followers" ? "Followers" : "Following"} ${before.toLocaleString("en-US")} → ${after.toLocaleString("en-US")}`
		body.append(html`<div class="btr-change-sub">${change > 0 ? `+${change}` : String(change)}</div>`)
	} else if (event.field === "groupRole") {
		const before = event.before as { id: number; name: string; role: string; rank: number }
		const after = event.after as { id: number; name: string; role: string; rank: number }

		title.append(
			after.rank > before.rank ? "Promoted in " : "Demoted in ",
			html`<a href="/communities/${after.id}">${after.name}</a>`,
		)
		body.append(swap(before.role, after.role))
	} else if (event.field === "isBanned") {
		title.textContent = event.after ? "Account banned" : "Account unbanned"
	} else {
		title.textContent = `${event.field} changed`
	}

	return item
}

/** What changed on someone's profile, newest first by day, filtered by kind of change. */
export const renderChanges = async (panel: HTMLElement, userId: number, state: { group: string }) => {
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
			for (const [kind, key] of [
				["place", "place"],
				["asset", "asset"],
			] as const) {
				const withImage = entries.filter((item) => item.dataset[key])
				const imageOf = await thumbnails(
					kind,
					withImage.map((item) => Number(item.dataset[key])),
				)

				for (const item of withImage) {
					const url = imageOf(Number(item.dataset[key]))

					if (url) {
						item.$find(".btr-change-icon")?.replaceWith(
							html`<img class="btr-change-badge btr-change-thumb" alt="" src="${url}" />`,
						)
					}
				}
			}

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
