import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import type { PresenceSegment } from "@/feat/activity/presence"
import { DAY, segmentEnd, formatDuration, startOfDay, nextDay } from "@/feat/activity/shared"
import { thumbnails } from "@/feat/activity/logs"

// The Stats tab: time online, most played games and the longest sessions.

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
export const renderStats = async (
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
