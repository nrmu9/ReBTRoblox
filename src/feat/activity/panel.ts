import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import {
	getRecentEvents,
	getUserNames,
	getWatchChecks,
	isTrackedItem,
	isWatchedUser,
	forceCheck,
	type ForceTarget,
} from "@/feat/activity/data"
import { openActivity } from "@/feat/activity/dialog"
import { peopleLabel, thumbnails } from "@/feat/activity/logs"
import { checkedAgo, checkNowButton, dayLabel, startOfDay } from "@/feat/activity/shared"
import { openShell } from "@/feat/activity/shell"
import type { ActivityEvent } from "@/feat/activity/store"
import { openTracked } from "@/feat/activity/trackDialog"

import { SETTINGS } from "@/feat/settings"

// Everything recorded, in one place: what happened lately across everyone and
// everything, and the lists of who and what is watched, each a page at a time.

const PAGE = 20

const listOf = (path: string): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get(path) || "[]")
		return Array.isArray(list) ? list.filter((id) => Number.isSafeInteger(id) && id > 0) : []
	} catch {
		return []
	}
}

const getJson = (url: string) =>
	fetch(url, { credentials: "include" })
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null)

/** Names and icons for tracked games, by universe. */
const gameInfo = async (ids: number[]) => {
	const info = new Map<number, { name: string; icon?: string | undefined }>()

	for (let i = 0; i < ids.length; i += 50) {
		const json = await getJson(
			`https://games.roblox.com/v1/games?universeIds=${ids.slice(i, i + 50).join(",")}`,
		)
		const games: any[] = json?.data ?? []
		const iconOf = await thumbnails(
			"place",
			games.map((game) => game.rootPlaceId),
		)

		for (const game of games) {
			info.set(game.id, { name: game.name, icon: iconOf(game.rootPlaceId) })
		}
	}

	return info
}

/** Names and emblems for tracked communities. */
const groupInfo = async (ids: number[]) => {
	const info = new Map<number, { name: string; icon?: string | undefined }>()

	for (let i = 0; i < ids.length; i += 50) {
		const batch = ids.slice(i, i + 50).join(",")
		const [groups, icons] = await Promise.all([
			getJson(`https://groups.roblox.com/v2/groups?groupIds=${batch}`),
			getJson(
				`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${batch}&size=150x150&format=Png`,
			),
		])
		const iconOf = new Map<number, string>(
			(icons?.data ?? []).map((item: any) => [item.targetId, item.imageUrl]),
		)

		for (const group of groups?.data ?? []) {
			info.set(group.id, { name: group.name, icon: iconOf.get(group.id) })
		}
	}

	return info
}

/** Whose event it is: a person, or a game or community folded into the same ids. */
const ownerOf = (userId: number) =>
	userId > 0
		? ({ kind: "user", id: userId } as const)
		: -userId % 2 === 0
			? ({ kind: "game", id: (-userId - 2) / 2 } as const)
			: ({ kind: "group", id: (-userId - 1) / 2 } as const)

const otherName = (event: ActivityEvent) => event.displayName || event.name || `User ${event.otherId}`

const named = (value: unknown) => (value as { name?: string } | undefined)?.name ?? "something"

/** One line for what happened. */
const summarize = (event: ActivityEvent, ownUserId: number | null): string => {
	if (event.kind === "profileChanged") {
		const before = event.before as any
		const after = event.after as any

		switch (event.field) {
			case "name":
				return `Username changed to @${after}`
			case "displayName":
				return `Display name changed to ${after}`
			case "description":
				return after ? "Bio changed" : "Bio cleared"
			case "avatar":
				return "Avatar changed"
			case "isBanned":
				return after ? "Banned" : "Unbanned"
			case "groupJoined":
				return `Joined ${named(after)}`
			case "groupLeft":
				return `Left ${named(before)}`
			case "groupRole":
				return `Now ${after?.role ?? "a new role"} in ${named(after)}`
			case "badge":
				return `Earned ${named(after)}`
			case "favoriteAdded":
				return `Favorited ${named(after)}`
			case "favoriteRemoved":
				return `Unfavorited ${named(before)}`
			case "followers":
				return `Followers ${before} → ${after}`
			case "followings":
				return `Following ${before} → ${after}`
			default:
				return "Profile changed"
		}
	}

	if (event.kind === "gameUpdated") {
		return "Updated"
	}

	if (event.kind === "shoutChanged") {
		return "New shout"
	}

	if (event.kind === "groupGameAdded") {
		return `New game: ${named(event.after)}`
	}

	return `${peopleLabel(event, event.userId === ownUserId)} · ${otherName(event)}`
}

/** A row that opens what it is about. */
const row = (options: {
	image?: string | undefined
	/** Games and communities have square icons, people round faces. */
	square?: boolean
	title: string
	subtitle?: string
	detail?: string
	onOpen: () => void
}) => {
	const item = html`<div class="btr-friendlog-row btr-panel-row" role="button" tabindex="0">
		<img class="btr-friendlog-avatar" alt="" />
		<span class="btr-friendlog-names">
			<span class="btr-friendlog-name">${options.title}</span>
			<span class="btr-friendlog-username">${options.subtitle ?? ""}</span>
		</span>
		<span class="btr-friendlog-kind">${options.detail ?? ""}</span>
	</div>`

	const img = item.$req<HTMLImageElement>("img")
	img.classList.toggle("btr-panel-square", !!options.square)

	if (options.image) {
		img.src = options.image
	}

	item.$on("click", (ev: Event) => {
		if (!(ev.target as Element).closest("button")) {
			options.onOpen()
		}
	})
	item.$on("keydown", (ev: KeyboardEvent) => {
		if (ev.key === "Enter" && ev.target === item) {
			options.onOpen()
		}
	})

	return item
}

/** A "Show more" that adds the next page, gone once there is nothing more. */
const pager = (panel: HTMLElement, next: () => Promise<boolean>) => {
	const more = html<HTMLButtonElement>`<button type="button" class="btr-activity-more">Show more</button>`

	more.$on("click", async () => {
		more.disabled = true
		const hasMore = await next()
		more.disabled = false
		more.hidden = !hasMore
		panel.append(more)
	})

	return more
}

const renderRecent = async (panel: HTMLElement, ownUserId: number | null) => {
	const list = html`<div class="btr-panel-list"></div>`
	panel.replaceChildren(list)

	let before: number | undefined
	let beforeId: number | undefined
	let lastDay: number | null = null

	const loadPage = async () => {
		const events = (await getRecentEvents(before, beforeId, PAGE)) ?? []

		if (!events.length && before === undefined) {
			panel.replaceChildren(
				html`<p class="btr-activity-empty">
					Nothing recorded yet. Watch people, or track games and communities, and what they do shows
					up here.
				</p>`,
			)
			return false
		}

		const owners = events.map((event) => ownerOf(event.userId))
		const userIds = owners.filter((owner) => owner.kind === "user").map((owner) => owner.id)
		const gameIds = owners.filter((owner) => owner.kind === "game").map((owner) => owner.id)
		const groupIds = owners.filter((owner) => owner.kind === "group").map((owner) => owner.id)

		const [names, faces, games, groups] = await Promise.all([
			getUserNames([...new Set(userIds)]),
			thumbnails("headshot", userIds),
			gameInfo([...new Set(gameIds)]),
			groupInfo([...new Set(groupIds)]),
		])

		for (const [i, event] of events.entries()) {
			const day = startOfDay(event.at)

			if (day !== lastDay) {
				lastDay = day
				list.append(html`<h4 class="btr-panel-day">${dayLabel(day)}</h4>`)
			}

			const owner = owners[i]
			const info =
				owner.kind === "user"
					? {
							name: names.get(owner.id)?.displayName ?? `User ${owner.id}`,
							icon: faces(owner.id),
						}
					: ((owner.kind === "game" ? games : groups).get(owner.id) ?? {
							name: owner.kind === "game" ? "A game" : "A community",
						})

			list.append(
				row({
					image: info.icon,
					square: owner.kind !== "user",
					title: info.name,
					subtitle: new Date(event.at).$format(clockFormat()),
					detail: summarize(event, ownUserId),
					onOpen: () =>
						owner.kind === "user"
							? void openActivity(owner.id, info.name, () => false, {
									isOwn: owner.id === ownUserId,
								})
							: openTracked(owner.kind, owner.id, info.name),
				}),
			)
		}

		const last = events.at(-1)!
		before = last.at
		beforeId = last.id
		return events.length === PAGE
	}

	if (await loadPage()) {
		panel.append(pager(panel, loadPage))
	}
}

/** The newest of someone's checks. */
const lastChecked = async (userId: number) => {
	const checks = await getWatchChecks(userId)
	const times = Object.values(checks ?? {}).filter((at): at is number => typeof at === "number")
	return times.length ? Math.max(...times) : null
}

const renderPeople = async (panel: HTMLElement, ownUserId: number | null) => {
	const ids = listOf("profile.watchedUsers")

	if (!ids.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				Nobody watched yet. Open someone's last seen on their profile and press Watch.
			</p>`,
		)
		return
	}

	const list = html`<div class="btr-panel-list"></div>`
	panel.replaceChildren(list)
	let shown = 0

	const loadPage = async () => {
		const page = ids.slice(shown, shown + PAGE)
		shown += page.length

		const [names, faces, checked] = await Promise.all([
			getUserNames(page),
			thumbnails("headshot", page),
			Promise.all(page.map(lastChecked)),
		])

		for (const [i, id] of page.entries()) {
			const name = names.get(id)
			const item = row({
				image: faces(id),
				title: name?.displayName ?? `User ${id}`,
				subtitle: name ? `@${name.name}` : "",
				detail: checked[i] ? `Checked ${checkedAgo(checked[i]!)}` : "Not checked yet",
				onOpen: () =>
					void openActivity(id, name?.displayName ?? `User ${id}`, () => false, {
						isOwn: id === ownUserId,
					}),
			})

			if (isWatchedUser(id)) {
				item.append(
					checkNowButton({ kind: "user", id }, async () => {
						const at = await lastChecked(id)
						item.$req(".btr-friendlog-kind").textContent = at
							? `Checked ${checkedAgo(at)}`
							: "Not checked yet"
					}),
				)
			}

			list.append(item)
		}

		return shown < ids.length
	}

	if (await loadPage()) {
		panel.append(pager(panel, loadPage))
	}
}

const renderTracked = async (panel: HTMLElement, kind: "game" | "group") => {
	const ids = listOf(kind === "game" ? "profile.trackedGames" : "profile.trackedGroups")

	if (!ids.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				${kind === "game" ? "No games tracked yet. Track one from its page." : "No communities tracked yet. Track one from its page."}
			</p>`,
		)
		return
	}

	const list = html`<div class="btr-panel-list"></div>`
	panel.replaceChildren(list)
	let shown = 0

	const loadPage = async () => {
		const page = ids.slice(shown, shown + PAGE)
		shown += page.length

		const info = await (kind === "game" ? gameInfo(page) : groupInfo(page))

		for (const id of page) {
			const name = info.get(id)?.name ?? (kind === "game" ? `Game ${id}` : `Community ${id}`)
			const item = row({
				image: info.get(id)?.icon,
				square: true,
				title: name,
				onOpen: () => openTracked(kind, id, name),
			})

			if (isTrackedItem(kind, id)) {
				item.append(checkNowButton({ kind, id }))
			}

			list.append(item)
		}

		return shown < ids.length
	}

	if (await loadPage()) {
		panel.append(pager(panel, loadPage))
	}
}

const PROGRESS_KEY = "activityForceProgress"

interface Progress {
	done: number
	total: number
	running: boolean
}

/** The panel's header button: checks everything, and says how far it has got. */
const setUpCheckAll = (button: HTMLButtonElement, onClose: (fn: () => void) => void) => {
	button.hidden = false
	button.textContent = "Check all"
	button.title = "Checks everyone and everything now, one at a time"

	const show = (progress: Progress | undefined) => {
		if (progress?.running) {
			button.disabled = true
			button.textContent = `Checking ${progress.done + 1} of ${progress.total}`
		} else if (button.disabled && progress) {
			button.disabled = false
			button.textContent = "Check all"
		}
	}

	chrome.storage.local.get(PROGRESS_KEY, (data) => show(data?.[PROGRESS_KEY] as Progress | undefined))

	const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		if (area === "local" && changes[PROGRESS_KEY]) {
			show(changes[PROGRESS_KEY].newValue as Progress | undefined)
		}
	}

	chrome.storage.onChanged.addListener(onChanged)
	onClose(() => chrome.storage.onChanged.removeListener(onChanged))

	button.$on("click", async () => {
		button.disabled = true
		button.textContent = "Starting…"

		const result = await forceCheck({ kind: "all" } satisfies ForceTarget)

		if (!result?.ok) {
			button.textContent = result?.wait
				? `Again in ${Math.ceil(result.wait / 60e3)} min`
				: "Could not check"

			setTimeout(() => {
				button.disabled = false
				button.textContent = "Check all"
			}, 4000)
		}
	})
}

/** Opens the panel with everything recorded. */
export const openActivityPanel = (ownUserId: number | null): void => {
	const shell = openShell({
		title: "Activity",
		subtitle: "Everyone and everything you keep an eye on",
		tabs: [
			["recent", "Recent"],
			["people", "People"],
			["games", "Games"],
			["groups", "Communities"],
		],
		onTab: (tab, panel) => {
			if (panel.childElementCount) {
				return
			}

			if (tab === "recent") {
				void renderRecent(panel, ownUserId)
			} else if (tab === "people") {
				void renderPeople(panel, ownUserId)
			} else {
				void renderTracked(panel, tab === "games" ? "game" : "group")
			}
		},
	})

	setUpCheckAll(shell.action, shell.onClose)
	shell.selectTab("recent")
}
