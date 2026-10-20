import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { getActivityEvents } from "@/feat/activity/data"
import { getPresenceHistory, onActivityChange } from "@/feat/activity/presence"
import { blocksByDay, joinSightings, loadTogether, render } from "@/feat/activity/timeline"
import { renderChanges, renderFriends } from "@/feat/activity/logs"
import { renderStats } from "@/feat/activity/stats"

// The activity a profile's last seen opens: everything ReBTRoblox saw the
// user doing, over the page like the settings panel. Each day is a bar across
// its 24 hours for the overview, and opens into a list for the details.

// Watching

const watchedList = (): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get("profile.watchedUsers") || "[]")
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

const isWatched = (userId: number): boolean => watchedList().includes(userId)

export const setWatched = (userId: number, watched: boolean): void => {
	const list = watchedList().filter((id) => id !== userId)
	SETTINGS.set("profile.watchedUsers", JSON.stringify(watched ? [...list, userId] : list))
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
				<button type="button" role="tab" data-tab="friends">People</button>
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
	let stopWatchingList: (() => void) | null = null

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
		stopWatchingList = SETTINGS.onChange("profile.watchedUsers", () => {
			updateWatch()
			updateTabs()
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
		stopWatchingList?.()
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
