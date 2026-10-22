import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { getPresenceHistory } from "@/feat/activity/presence"
import { formatDuration, segmentEnd } from "@/feat/activity/shared"
import { clockFormat } from "@/feat/clock"
import { getCachedServerLocation, getServerDetails, regionLabel } from "@/feat/serverDetails"
import { formatNumber, loggedInUserPromise } from "@/pages/common"

// A game page's numbers kept current while it is open, and your own time in
// the game: how long you have played it, and the servers you were last in.

/** The latest numbers, which the exact counts read too so neither undoes the other. */
export const liveCounts: { visits: number | null } = { visits: null }

const LIVE_EVERY = 30e3

const compact = (value: number) =>
	value < 1e4
		? formatNumber(value)
		: `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}+`

/** Writes `text` into `element` if it changed, with a short fade so the change is seen. */
const update = (element: HTMLElement | null, text: string) => {
	if (!element || element.textContent === text) {
		return
	}

	element.textContent = text

	if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
		element.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 600, easing: "ease-out" })
	}
}

/**
 * Players, visits, favorites and votes refreshed every 30 seconds while the
 * page is in view, and at once when it comes back into view.
 */
export const startLiveStats = (universeId: number, exact: boolean) => {
	const format = (value: number) => (exact ? formatNumber(value) : compact(value))

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

		const game = games?.data?.find((entry: any) => entry.id === universeId)
		const vote = votes?.data?.find((entry: any) => entry.id === universeId)

		if (game) {
			update(
				document.querySelector(".game-stat-container .game-stat:first-child .text-lead"),
				formatNumber(game.playing ?? 0),
			)

			if (Number.isSafeInteger(game.favoritedCount)) {
				update(
					document.querySelector("[data-testid='game-favorites-count']"),
					format(game.favoritedCount),
				)
			}

			if (Number.isSafeInteger(game.visits)) {
				liveCounts.visits = game.visits
				update(document.querySelector("#game-visits-count"), format(game.visits))
			}
		}

		if (Number.isSafeInteger(vote?.upVotes) && Number.isSafeInteger(vote?.downVotes)) {
			for (const [id, count] of [
				["#vote-up-text", vote.upVotes],
				["#vote-down-text", vote.downVotes],
			] as const) {
				const element = document.querySelector<HTMLElement>(id)
				// The exact counts read the title, so it moves first.
				element?.setAttribute("title", String(count))
				update(element, format(count))
			}

			const total = vote.upVotes + vote.downVotes
			const bar = document.querySelector<HTMLElement>(".vote-percentage")

			if (bar && total) {
				bar.style.width = `${Math.round((vote.upVotes / total) * 100)}%`
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
