import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { getPresenceHistory } from "@/feat/activity/presence"
import { formatDuration, segmentEnd } from "@/feat/activity/shared"
import { clockFormat } from "@/feat/clock"
import { createSettler, rampValue } from "@/feat/liveSample"
import { getCachedServerLocation, getServerDetails, regionLabel } from "@/feat/serverDetails"
import { formatNumber, loggedInUserPromise } from "@/pages/common"

// A game page's numbers kept current while it is open, and your own time in
// the game: how long you have played it, and the servers you were last in.

/** The latest numbers, which the exact counts read too so neither undoes the other. */
export const liveCounts: { visits: number | null } = { visits: null }

// Visits move every few seconds on a busy game, so this is about as often as
// there is something new to show.
const LIVE_EVERY = 10e3
const ROLL = 800

const compact = (value: number) =>
	value < 1e4
		? formatNumber(value)
		: `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}+`

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** A count on the page, moved to each new value rather than jumping there. */
class LiveCount {
	private target: number | null = null
	private shown: number | null = null
	private frame = 0

	constructor(
		private readonly find: () => HTMLElement | null,
		private readonly format: (value: number) => string,
		// Written before the text, for the exact counts that read it.
		private readonly onValue?: (value: number, element: HTMLElement) => void,
	) {}

	/** Counts from the shown value to `value` over `duration`, tinted by which way it went. */
	set(value: number, duration = ROLL) {
		const element = this.find()

		if (!element) {
			return
		}

		if (value === this.target) {
			return
		}

		// From what is on screen, which is partway there when a new value comes mid-count.
		const from = this.shown ?? value
		this.target = value
		cancelAnimationFrame(this.frame)

		if (from === value || still() || document.visibilityState !== "visible") {
			this.write(element, value)
			return
		}

		// Only a jump gets the tint. Visits creeping up all the time would never lose it.
		if (duration === ROLL) {
			element.animate(
				{ color: [value > from ? "#3fb950" : "#f85149", getComputedStyle(element).color] },
				{ duration: 1200, easing: "ease-out" },
			)
		}

		const started = performance.now()

		const step = () => {
			const current = rampValue(from, value, performance.now() - started, duration)
			this.write(element, current)

			if (current !== value) {
				this.frame = requestAnimationFrame(step)
			}
		}

		step()
	}

	private write(element: HTMLElement, value: number) {
		this.shown = value
		this.onValue?.(value, element)
		const text = this.format(value)

		if (element.textContent !== text) {
			element.textContent = text
		}
	}
}

/**
 * Players, visits, favorites and votes kept current while the page is in
 * view, and at once when it comes back into view. Visits count up smoothly
 * toward each new sample, so a busy game's visits keep moving rather than
 * jumping every few seconds.
 */
export const startLiveStats = (universeId: number, exact: boolean) => {
	const format = (value: number) => (exact ? formatNumber(value) : compact(value))
	const vote = (id: string) =>
		new LiveCount(
			() => document.querySelector<HTMLElement>(id),
			format,
			// The exact counts read the title, so it moves first.
			(value, element) => element.setAttribute("title", String(value)),
		)

	const counts = {
		playing: new LiveCount(
			() => document.querySelector(".game-stat-container .game-stat:first-child .text-lead"),
			formatNumber,
		),
		favorites: new LiveCount(
			() => document.querySelector("[data-testid='game-favorites-count']"),
			format,
		),
		visits: new LiveCount(
			() => document.querySelector("#game-visits-count"),
			format,
			(value, element) => {
				liveCounts.visits = value
				// Compact visits hardly ever change, so the exact number is on hover.
				if (!exact) {
					element.title = formatNumber(value)
				}
			},
		),
		up: vote("#vote-up-text"),
		down: vote("#vote-down-text"),
	}

	const settle = {
		playing: createSettler(),
		favorites: createSettler(),
		up: createSettler(),
		down: createSettler(),
	}
	let visits = 0

	const refresh = async () => {
		const [games, votes] = await Promise.all(
			[
				`https://games.roblox.com/v1/games?universeIds=${universeId}`,
				`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`,
			].map((url) =>
				fetch(url, { credentials: "include" })
					.then((res) => (res.ok ? res.json() : null))
					.catch(() => null),
			),
		)

		const now = Date.now()
		const game = games?.data?.find((entry: any) => entry.id === universeId)
		const vote = votes?.data?.find((entry: any) => entry.id === universeId)

		if (game) {
			if (Number.isSafeInteger(game.playing)) {
				counts.playing.set(settle.playing(game.playing, now))
			}

			if (Number.isSafeInteger(game.favoritedCount)) {
				counts.favorites.set(settle.favorites(game.favoritedCount, now))
			}

			// Visits only go up, so an older cache's lower count is ignored.
			if (Number.isSafeInteger(game.visits) && game.visits > visits) {
				const first = !visits
				visits = game.visits
				// A little longer than until the next sample, so the count never stops between them.
				counts.visits.set(visits, first ? undefined : LIVE_EVERY * 1.5)
			}
		}

		if (Number.isSafeInteger(vote?.upVotes) && Number.isSafeInteger(vote?.downVotes)) {
			const up = settle.up(vote.upVotes, now)
			const down = settle.down(vote.downVotes, now)
			counts.up.set(up)
			counts.down.set(down)

			const bar = document.querySelector<HTMLElement>(".vote-percentage")

			if (bar && up + down) {
				bar.style.width = `${Math.round((up / (up + down)) * 100)}%`
			}
		}
	}

	let timer: ReturnType<typeof setInterval> | undefined

	const run = () => {
		clearInterval(timer)

		if (document.visibilityState === "visible") {
			timer = setInterval(refresh, LIVE_EVERY)
		}
	}

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			void refresh()
		}
		run()
	})

	void refresh()
	run()
}

/** Your own sessions in this game, oldest first, each with when it ended. */
const sessionsIn = async (placeId: number) => {
	const userId = await loggedInUserPromise

	if (userId <= 0) {
		return []
	}

	const segments = await getPresenceHistory(userId)
	const sessions: Array<(typeof segments)[number] & { end: number }> = []

	segments.forEach((segment, index) => {
		const end = segmentEnd(segments, index, false)

		if (segment.type === 2 && segment.placeId === placeId && end > segment.from) {
			sessions.push(Object.assign({ end }, segment))
		}
	})

	return sessions
}

const when = (at: number) => new Date(at).$format(`MMM D, ${clockFormat()}`)

/** "Your Playtime" with the game's other stats, once you have played it. */
export const addPlaytime = async (placeId: number) => {
	const sessions = await sessionsIn(placeId)
	const total = sessions.reduce((sum, session) => sum + session.end - session.from, 0)

	if (total < 60e3) {
		return
	}

	const last = sessions.at(-1)!
	const stat = html`<li class="game-stat btr-playtime">
		<p class="text-label text-overflow font-caption-header">Your Playtime</p>
		<p class="text-lead font-caption-body">${formatDuration(total)}</p>
	</li>`

	stat.title = `${sessions.length === 1 ? "1 session" : `${sessions.length} sessions`}, last on ${when(last.from)}`

	document.$watch(".game-stat-container", (list: HTMLElement) => {
		if (!list.$find(".btr-playtime")) {
			list.append(stat)
		}
	})
}

/** The servers you were last in here, newest first, with whether they are still up. */
export const addRecentServers = async (placeId: number) => {
	const sessions = await sessionsIn(placeId)
	const servers = new Map<string, { from: number; time: number }>()

	for (const session of sessions.toReversed()) {
		if (!session.gameId) {
			continue
		}

		const server = servers.get(session.gameId) ?? { from: session.from, time: 0 }
		server.time += session.end - session.from
		servers.set(session.gameId, server)
	}

	const recent = [...servers].slice(0, 4)

	if (!recent.length) {
		return
	}

	const section = html`<div class="stack server-list-section btr-recent-servers">
		<div class="container-header">
			<div class="server-list-container-header">
				<h2 class="server-list-header">Your Recent Servers</h2>
			</div>
		</div>
		<ul class="card-list rbx-public-game-server-item-container"></ul>
	</div>`

	const list = section.$req("ul")

	for (const [jobId, server] of recent) {
		const card = html`<li class="rbx-public-game-server-item col-md-3 col-sm-4 col-xs-6">
			<div class="card-item card-item-public-server">
				<div class="rbx-public-game-server-details game-server-details">
					<div class="text-info rbx-game-status rbx-public-game-server-status text-overflow"></div>
					<span data-placeid="${placeId}">
						<button
							type="button"
							class="btn-full-width btn-control-xs rbx-public-game-server-join game-server-join-btn btn-primary-md btn-min-width"
						>
							Join
						</button>
					</span>
					<div class="server-id-text text-info xsmall">
						ID: ${jobId.split("-").slice(1, 3).join("-")}
					</div>
				</div>
			</div>
		</li>`

		const status = card.$req(".rbx-game-status")
		const join = card.$req<HTMLButtonElement>("button")
		const lines = [`Joined ${when(server.from)}`, `Played ${formatDuration(server.time)}`]

		const show = (state: string) => {
			const region = regionLabel(getCachedServerLocation(jobId))
			status.textContent = [...lines, state, ...(region ? [`Region: ${region}`] : [])].join("\n")
		}

		show("Checking...")

		// A server still up answers with where it is; one that has ended does not.
		getServerDetails(placeId, jobId, (details: any) => {
			const up = details?.success || details?.status === 22
			show(up ? (details.status === 22 ? "Running, full" : "Still running") : "Ended")
			join.disabled = !up

			// Only a running server gets Copy Link, which follows this id.
			if (up) {
				join.dataset.btrInstanceId = jobId
			}
		})

		join.$on("click", (ev: MouseEvent) => {
			ev.preventDefault()
			injectScript.call("gamedetailsJoinServer", placeId, jobId)
		})

		list.append(card)
	}

	document.$watch("#rbx-friends-running-games", (friends: HTMLElement) => {
		if (!document.querySelector(".btr-recent-servers")) {
			friends.before(section)
		}
	})
}
