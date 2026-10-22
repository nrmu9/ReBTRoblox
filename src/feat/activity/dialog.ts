import { SETTINGS } from "@/feat/settings"
import { getActivityEvents, refreshWatched } from "@/feat/activity/data"
import { getPresenceHistory, onActivityChange, type PresenceSegment } from "@/feat/activity/presence"
import { openShell } from "@/feat/activity/shell"
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
	// What is shown should be current, so their checks catch up first.
	refreshWatched(userId)

	const statsState = { period: "30" }
	const friendFilter = { group: "all" }
	const changeFilter = { group: "all" }
	// What the panels are drawn from, kept current by live changes.
	let shown: PresenceSegment[] | null = null

	const shell = openShell({
		title: "Activity",
		subtitle: name,
		tabs: [
			["activity", "Activity"],
			["stats", "Stats"],
			["friends", "People"],
			["changes", "Changes"],
		],
		onTab: (tab, panel) => {
			if (panel.childElementCount || !shown) {
				return
			}

			if (tab === "stats") {
				void renderStats(panel, shown, isOnline(), statsState)
			} else if (tab === "friends") {
				void renderFriends(panel, userId, !!options.isOwn, friendFilter)
			} else if (tab === "changes") {
				void renderChanges(panel, userId, changeFilter)
			}
		},
	})

	const { panels, tabs, action } = shell

	// Until the history is in, only Activity shows, and it is empty.
	const friendsTab = tabs.$req('[data-tab="friends"]')
	const changesTab = tabs.$req('[data-tab="changes"]')
	friendsTab.hidden = changesTab.hidden = true
	shell.selectTab("activity")

	const [history, playedTogether, events] = await Promise.all([
		getPresenceHistory(userId),
		loadTogether(userId),
		options.isOwn ? Promise.resolve(null) : getActivityEvents(userId),
	])
	const { segments, together } = joinSightings(history, playedTogether)
	shown = segments

	// The latest day starts open, the rest wait for a click.
	const latest = Math.max(...blocksByDay(segments, isOnline()).keys())
	const expanded = new Set(Number.isFinite(latest) ? [latest] : [])

	render(panels.activity, segments, isOnline(), together, expanded, true)

	// People shows for your own list and for people watched now or before,
	// Changes for people watched now or before.
	const updateTabs = () => {
		const watched = !options.isOwn && isWatched(userId)
		friendsTab.hidden =
			!options.isOwn && !watched && !events?.some((event) => event.kind !== "profileChanged")
		changesTab.hidden = !watched && !events?.some((event) => event.kind === "profileChanged")
	}

	updateTabs()

	// Watching anyone but yourself.
	if (!options.isOwn) {
		const updateWatch = () => {
			const watched = isWatched(userId)
			action.setAttribute("aria-pressed", String(watched))
			action.textContent = watched ? "Watching" : "Watch"
			action.title = watched
				? "Stop checking on them"
				: "Checks where they are, their friends and their profile from the background"
		}

		action.hidden = false
		action.$on("click", () => setWatched(userId, !isWatched(userId)))
		shell.onClose(
			SETTINGS.onChange("profile.watchedUsers", () => {
				updateWatch()
				updateTabs()
			}),
		)
		updateWatch()
	}

	shell.selectTab(options.tab ?? "activity")

	shell.onClose(
		onActivityChange([userId], async () => {
			const joined = joinSightings(
				...(await Promise.all([getPresenceHistory(userId), loadTogether(userId)])),
			)
			render(panels.activity, joined.segments, isOnline(), joined.together, expanded)
			shown = joined.segments

			if (panels.stats.childElementCount) {
				void renderStats(panels.stats, shown, isOnline(), statsState)
			}

			if (panels.friends.childElementCount) {
				void renderFriends(panels.friends, userId, !!options.isOwn, friendFilter)
			}

			if (panels.changes.childElementCount) {
				void renderChanges(panels.changes, userId, changeFilter)
			}
		}),
	)
}
