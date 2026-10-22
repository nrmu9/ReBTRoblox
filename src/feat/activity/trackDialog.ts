import { html } from "@/core/html"
import { getActivityEvents, isTrackedItem } from "@/feat/activity/data"
import { lineChart, type ChartMarker, type ChartPoint } from "@/feat/activity/chart"
import { buildLog, icon, swap } from "@/feat/activity/logs"
import { onActivityChange } from "@/feat/activity/presence"
import { checkedAgo, checkNowButton, DAY } from "@/feat/activity/shared"
import { openShell } from "@/feat/activity/shell"
import { gameSubject, groupSubject, type ActivityEvent } from "@/feat/activity/store"
import { clockFormat } from "@/feat/clock"
import { SETTINGS } from "@/feat/settings"

// A tracked game's or community's activity over the page: its counts drawn
// over time, and a log of its updates, shouts and new games.

export type TrackedKind = "game" | "group"

const settingOf = (kind: TrackedKind) => (kind === "game" ? "profile.trackedGames" : "profile.trackedGroups")

const trackedList = (kind: TrackedKind): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get(settingOf(kind)) || "[]")
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

export const isTracked = (kind: TrackedKind, id: number): boolean => trackedList(kind).includes(id)

export const setTracked = (kind: TrackedKind, id: number, tracked: boolean): void => {
	const list = trackedList(kind).filter((other) => other !== id)
	SETTINGS.set(settingOf(kind), JSON.stringify(tracked ? [...list, id] : list))
}

const PERIODS = [
	["1", "24 hours"],
	["7", "7 days"],
	["30", "30 days"],
	["all", "All time"],
] as const

const pointsOf = (samples: ActivityEvent[], field: string): ChartPoint[] =>
	samples
		.filter((sample) => sample.field === field)
		.map((sample) => ({ at: sample.at, value: Number(sample.after) }))
		.toReversed()

/** Likes as a share of all votes, from the samples taken together. */
const ratingOf = (samples: ActivityEvent[]): ChartPoint[] => {
	const dislikes = new Map<number, number>()

	for (const sample of samples) {
		if (sample.field === "dislikes") {
			dislikes.set(sample.at, Number(sample.after))
		}
	}

	return samples
		.filter((sample) => sample.field === "likes" && dislikes.has(sample.at))
		.map((sample) => {
			const up = Number(sample.after)
			const total = up + dislikes.get(sample.at)!
			return { at: sample.at, value: total ? (up / total) * 100 : 0 }
		})
		.filter((point) => Number.isFinite(point.value))
		.toReversed()
}

const percent = (value: number, decimals = 1) => `${Number(value.toFixed(decimals))}%`

const card = (label: string, value: string, detail = "") =>
	html`<div class="btr-activity-stat">
		<div class="btr-activity-stat-label">${label}</div>
		<div class="btr-activity-stat-value">${value}</div>
		<div class="btr-activity-stat-detail">${detail}</div>
	</div>`

const signed = (value: number) =>
	value > 0 ? `+${value.toLocaleString("en-US")}` : value.toLocaleString("en-US")

const renderOverview = async (
	panel: HTMLElement,
	kind: TrackedKind,
	subject: number,
	state: { period: string },
) => {
	const since = state.period === "all" ? undefined : Date.now() - Number(state.period) * DAY

	// Refetching keeps what is drawn, faded, rather than blanking it.
	panel.classList.add("btr-track-loading")
	const [samples, happenings] = await Promise.all([
		getActivityEvents(subject, ["sample"], since).then((events) => events ?? []),
		getActivityEvents(subject, kind === "game" ? ["gameUpdated"] : ["shoutChanged"], since).then(
			(events) => events ?? [],
		),
	])
	panel.classList.remove("btr-track-loading")

	const toolbar = html`<div class="btr-friendlog-filters" role="group" aria-label="Period"></div>`

	for (const [period, label] of PERIODS) {
		const chip = html`<button
			type="button"
			class="btr-friendlog-filter"
			aria-pressed="${period === state.period}"
		>
			${label}
		</button>`

		chip.$on("click", () => {
			state.period = period
			void renderOverview(panel, kind, subject, state)
		})

		toolbar.append(chip)
	}

	const checked = html`<p class="btr-track-checked"></p>`
	const latest = samples[0]?.at
	checked.textContent = latest
		? `Last checked ${checkedAgo(latest)}, every ${kind === "game" ? "15 minutes" : "hour"}`
		: "Not checked yet"

	// The subject is the id folded into the log's ids, which unfolds back.
	const id = kind === "game" ? (-subject - 2) / 2 : (-subject - 1) / 2

	if (isTrackedItem(kind, id)) {
		checked.append(checkNowButton({ kind, id }, () => void renderOverview(panel, kind, subject, state)))
	}

	const markers: ChartMarker[] = happenings
		.map((event) => ({ at: event.at, label: kind === "game" ? "Updated" : "Shout" }))
		.toReversed()

	const cards = html`<div class="btr-activity-summary btr-stats-cards"></div>`
	const charts = html`<div class="btr-track-charts"></div>`

	if (kind === "game") {
		const players = pointsOf(samples, "players")
		const visits = pointsOf(samples, "visits")
		const favorites = pointsOf(samples, "favorites")
		const rating = ratingOf(samples)
		const values = players.map((point) => point.value)
		const peak = players.find((point) => point.value === Math.max(...values))
		const likes = samples.find((sample) => sample.field === "likes")?.after as number | undefined
		const dislikes = samples.find((sample) => sample.field === "dislikes")?.after as number | undefined

		cards.append(
			card("Playing", players.length ? players.at(-1)!.value.toLocaleString("en-US") : "–"),
			card(
				"Peak",
				peak ? peak.value.toLocaleString("en-US") : "–",
				peak ? new Date(peak.at).$format(`MMM D, ${clockFormat()}`) : "",
			),
			card(
				"Average",
				values.length
					? Math.round(
							values.reduce((sum, value) => sum + value, 0) / values.length,
						).toLocaleString("en-US")
					: "–",
			),
			card("Visits gained", visits.length > 1 ? signed(visits.at(-1)!.value - visits[0].value) : "–"),
			card(
				"Favorites",
				favorites.length ? favorites.at(-1)!.value.toLocaleString("en-US") : "–",
				favorites.length > 1
					? `${signed(favorites.at(-1)!.value - favorites[0].value)} in this time`
					: "",
			),
			card(
				"Rating",
				rating.length ? percent(rating.at(-1)!.value) : "–",
				likes !== undefined && dislikes !== undefined
					? `${likes.toLocaleString("en-US")} likes, ${dislikes.toLocaleString("en-US")} dislikes`
					: "",
			),
		)

		charts.append(
			lineChart("Players", players, { markers, daily: "peak" }),
			lineChart("Visits", visits, { markers, daily: "gain" }),
			lineChart("Favorites", favorites, { markers, daily: "gain" }),
			lineChart("Rating", rating, { markers, format: percent, axis: percent }),
		)
	} else {
		const members = pointsOf(samples, "members")

		cards.append(
			card("Members", members.length ? members.at(-1)!.value.toLocaleString("en-US") : "–"),
			card("Change", members.length > 1 ? signed(members.at(-1)!.value - members[0].value) : "–"),
		)

		charts.append(lineChart("Members", members, { markers, daily: "gain" }))
	}

	panel.replaceChildren(toolbar, checked, cards, charts)
}

const LOG_GROUPS = [
	["all", "All"],
	["updates", "Updates"],
	["shouts", "Shouts"],
	["games", "New games"],
	["changes", "Name and description"],
] as const

const logGroup = (event: ActivityEvent) =>
	event.kind === "gameUpdated"
		? "updates"
		: event.kind === "shoutChanged"
			? "shouts"
			: event.kind === "groupGameAdded"
				? "games"
				: "changes"

const logEntry = (event: ActivityEvent) => {
	const item = html`<div class="btr-change">
		<div class="btr-change-body">
			<div class="btr-change-title"></div>
		</div>
		<span class="btr-change-time">${new Date(event.at).$format(clockFormat())}</span>
	</div>`

	const title = item.$req(".btr-change-title")
	const body = item.$req(".btr-change-body")
	const after = event.after as any

	if (event.kind === "gameUpdated") {
		item.prepend(icon("updates"))
		title.textContent = "Updated"
	} else if (event.kind === "shoutChanged") {
		item.prepend(icon("shouts"))
		title.append("Shout")

		if (after?.posterId) {
			title.append(
				" by ",
				html`<a href="/users/${after.posterId}/profile">${after.posterName ?? "someone"}</a>`,
			)
		}

		const text = html`<div class="btr-change-shout"></div>`
		text.textContent = String(after?.body ?? "")
		body.append(text)
	} else if (event.kind === "groupGameAdded") {
		item.prepend(icon("games"))
		title.append(
			"Published ",
			after?.placeId
				? html`<a href="/games/${after.placeId}">${after.name}</a>`
				: String(after?.name ?? "a game"),
		)
	} else if (event.field === "name") {
		item.prepend(icon("names"))
		title.textContent = "Renamed"
		body.append(swap(event.before, event.after))
	} else {
		item.prepend(icon("bio"))
		title.textContent = "Description changed"

		const details = html`<details class="btr-change-details">
			<summary>Compare</summary>
			<div class="btr-change-before"></div>
			<div class="btr-change-after"></div>
		</details>`

		details.$req(".btr-change-before").textContent = String(event.before || "(empty)")
		details.$req(".btr-change-after").textContent = String(event.after || "(empty)")
		body.append(details)
	}

	// Updates, shouts and new games carry Roblox's own times.
	if (!event.exact) {
		item.$req(".btr-change-time").title = "Noticed at this time"
	}

	return item
}

const renderLog = async (
	panel: HTMLElement,
	kind: TrackedKind,
	subject: number,
	state: { group: string },
) => {
	const events =
		(await getActivityEvents(subject, [
			"gameUpdated",
			"shoutChanged",
			"groupGameAdded",
			"profileChanged",
		])) ?? []

	if (!events.length) {
		panel.replaceChildren(
			html`<p class="btr-activity-empty">
				${kind === "game" ? "No updates seen yet." : "No shouts, new games or changes seen yet."}
			</p>`,
		)
		return
	}

	buildLog({
		panel,
		events,
		groups: LOG_GROUPS,
		groupOf: logGroup,
		entry: logEntry,
		state,
		hideEmpty: true,
	})
}

/** A tracked game's or community's activity, by universe or community id. */
export const openTracked = (kind: TrackedKind, id: number, name: string): void => {
	const subject = kind === "game" ? gameSubject(id) : groupSubject(id)
	const overviewState = { period: "7" }
	const logState = { group: "all" }

	const shell = openShell({
		title: kind === "game" ? "Game activity" : "Community activity",
		subtitle: name,
		tabs: [
			["overview", "Overview"],
			["log", "Log"],
		],
		onTab: (tab, panel) => {
			if (panel.childElementCount) {
				return
			}

			if (tab === "overview") {
				void renderOverview(panel, kind, subject, overviewState)
			} else {
				void renderLog(panel, kind, subject, logState)
			}
		},
	})

	const { action, panels } = shell

	const updateAction = () => {
		const tracked = isTracked(kind, id)
		action.setAttribute("aria-pressed", String(tracked))
		action.textContent = tracked ? "Tracking" : "Track"
		action.title = tracked ? "Stop checking on it" : "Checks on it from the background"
	}

	action.hidden = false
	action.$on("click", () => setTracked(kind, id, !isTracked(kind, id)))
	shell.onClose(SETTINGS.onChange(settingOf(kind), updateAction))
	updateAction()

	shell.selectTab("overview")

	shell.onClose(
		onActivityChange([subject], () => {
			if (panels.overview.childElementCount) {
				void renderOverview(panels.overview, kind, subject, overviewState)
			}

			if (panels.log.childElementCount) {
				void renderLog(panels.log, kind, subject, logState)
			}
		}),
	)
}
