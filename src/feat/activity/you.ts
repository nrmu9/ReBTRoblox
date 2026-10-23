import { html } from "@/core/html"
import { getJson } from "@/core/util"
import { openActivity } from "@/feat/activity/dialog"
import { renderFriends } from "@/feat/activity/logs"
import { getPresenceHistory } from "@/feat/activity/presence"
import { DAY, formatDuration, onlineSince, startOfDay } from "@/feat/activity/shared"
import { fillGameIcons, gameRows, statCard, statsSince } from "@/feat/activity/stats"
import { SETTINGS } from "@/feat/settings"

// The You tab of the activity panel: your own numbers at a glance, your week,
// and everything the friend log recorded about you.

/** A count from Roblox, with a + when it is at the most Roblox will say. */
const count = (url: string, cap?: number) =>
	getJson<{ count?: number }>(url).then((json) => {
		const value = json?.count

		if (!Number.isSafeInteger(value)) {
			return "?"
		}

		return `${value!.toLocaleString()}${cap !== undefined && value! >= cap ? "+" : ""}`
	})

export const renderYou = async (panel: HTMLElement, ownUserId: number | null): Promise<void> => {
	if (!ownUserId) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">Sign in to Roblox to see your own activity.</p>`,
		)
		return
	}

	const view = html`<div class="btr-panel-you">
		<div class="btr-activity-summary btr-stats-cards"></div>
		<div class="btr-panel-you-actions">
			<button type="button" class="btr-settings-button" data-tab="activity">Timeline</button>
			<button type="button" class="btr-settings-button" data-tab="stats">All stats</button>
		</div>
		<h3 class="btr-stats-heading">Most played this week</h3>
		<div class="btr-stats-games"></div>
		<h3 class="btr-stats-heading">People</h3>
		<div class="btr-panel-you-people"></div>
	</div>`

	for (const button of view.$findAll<HTMLButtonElement>("[data-tab]")) {
		button.$on("click", () => {
			void openActivity(ownUserId, "You", () => false, {
				isOwn: true,
				tab: button.dataset.tab as "activity" | "stats",
			})
		})
	}

	panel.replaceChildren(view)

	const base = `https://friends.roblox.com/v1/users/${ownUserId}`
	const [friends, followers, following, requests, segments] = await Promise.all([
		count(`${base}/friends/count`),
		count(`${base}/followers/count`),
		count(`${base}/followings/count`),
		// Roblox stops counting requests at 500.
		count("https://friends.roblox.com/v1/user/friend-requests/count", 500),
		SETTINGS.get("profile.lastSeen") ? getPresenceHistory(ownUserId) : Promise.resolve([]),
	])

	const now = Date.now()
	const week = statsSince(segments, false, now - 7 * DAY)
	const today = onlineSince(segments, false, startOfDay(now))
	const recorded = segments.length > 0

	view.$req(".btr-stats-cards").append(
		statCard("Friends", friends),
		statCard("Followers", followers),
		statCard("Following", following),
		statCard("Friend requests", requests, "waiting for you"),
		statCard("Online today", recorded ? formatDuration(today) : "-"),
		statCard(
			"Online this week",
			recorded ? formatDuration(week.onlineTime) : "-",
			recorded ? `${formatDuration(week.gameTime)} in experiences` : "Needs Last Seen Online",
		),
	)

	const games = view.$req(".btr-stats-games")
	games.append(
		...(week.games.length
			? gameRows(week.games, 3)
			: [html`<p class="btr-stats-none">No time in experiences this week.</p>`]),
	)

	const people = view.$req(".btr-panel-you-people")

	if (SETTINGS.get("profile.friendLog")) {
		await renderFriends(people, ownUserId, true, { group: "all" })
	} else {
		people.append(
			html`<p class="btr-activity-empty">
				Turn on Friend Log under Activity in the settings to record your friends, requests and
				followers.
			</p>`,
		)
	}

	await fillGameIcons(games)
}
