import {
	announceChange,
	committed,
	gameSubject,
	getState,
	groupSubject,
	isFull,
	openDb,
	setState,
	type ActivityEvent,
} from "@/feat/activity/store"
import { SETTINGS } from "@/feat/settings"

// Games and communities you chose to track, checked from the background with
// read requests only: player counts, visits and updates for games; members,
// shouts and new games for communities. Counts are kept as samples, so the
// dialog can draw them over time.

const GAMES_EVERY = 15 * 60e3
const GROUPS_EVERY = 60 * 60e3
const GROUP_GAMES_EVERY = 4 * 60 * 60e3

const listOf = (path: string): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get(path) || "[]")
		return Array.isArray(list) ? list.filter((id) => Number.isSafeInteger(id) && id > 0) : []
	} catch {
		return []
	}
}

export const getTrackedGames = (): number[] => listOf("profile.trackedGames")
export const getTrackedGroups = (): number[] => listOf("profile.trackedGroups")

const getJson = (url: string) =>
	fetch(url, { credentials: "include" })
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null)

type NewEvent = Omit<ActivityEvent, "id">

const write = async (events: NewEvent[]) => {
	if (!events.length || (await isFull())) {
		return
	}

	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const event of events) {
		tx.objectStore("events").add(event)
	}

	await committed(tx)
	announceChange(new Set(events.map((event) => event.userId)))
}

interface GameState {
	name: string
	placeId: number
	updated: string
}

/** Every tracked game in two requests per 50: counts as samples, and updates by Roblox's own time. */
const checkGames = async (universeIds: number[]) => {
	const events: NewEvent[] = []
	const now = Date.now()

	for (let i = 0; i < universeIds.length; i += 50) {
		const ids = universeIds.slice(i, i + 50).join(",")
		const [json, votes] = await Promise.all([
			getJson(`https://games.roblox.com/v1/games?universeIds=${ids}`),
			getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids}`),
		])
		const votesOf = new Map<number, any>((votes?.data ?? []).map((entry: any) => [entry.id, entry]))

		for (const game of json?.data ?? []) {
			const userId = gameSubject(game.id)
			const before = await getState<GameState>(`game:${game.id}`)

			events.push(
				{ userId, at: now, kind: "sample", field: "players", after: game.playing ?? 0 },
				{ userId, at: now, kind: "sample", field: "visits", after: game.visits ?? 0 },
			)

			if (Number.isSafeInteger(game.favoritedCount)) {
				events.push({
					userId,
					at: now,
					kind: "sample",
					field: "favorites",
					after: game.favoritedCount,
				})
			}

			const vote = votesOf.get(game.id)

			if (Number.isSafeInteger(vote?.upVotes) && Number.isSafeInteger(vote?.downVotes)) {
				events.push(
					{ userId, at: now, kind: "sample", field: "likes", after: vote.upVotes },
					{ userId, at: now, kind: "sample", field: "dislikes", after: vote.downVotes },
				)
			}

			if (before && before.updated !== game.updated && Date.parse(game.updated)) {
				events.push({
					userId,
					at: Date.parse(game.updated),
					exact: true,
					kind: "gameUpdated",
					after: { name: game.name },
				})
			}

			if (before && before.name !== game.name) {
				events.push({
					userId,
					at: now,
					kind: "profileChanged",
					field: "name",
					before: before.name,
					after: game.name,
				})
			}

			await setState(`game:${game.id}`, {
				name: game.name,
				placeId: game.rootPlaceId,
				updated: game.updated,
			})
		}
	}

	await write(events)
}

interface GroupState {
	name: string
	description: string
	shout: string | null
	shoutAt: string | null
	games?: number[]
}

/** A community's members as a sample, its shout by the time it was posted, and its name and description. */
const checkGroup = async (groupId: number) => {
	const group = await getJson(`https://groups.roblox.com/v1/groups/${groupId}`)

	if (!group?.name) {
		return
	}

	const userId = groupSubject(groupId)
	const before = await getState<GroupState>(`group:${groupId}`)
	const now = Date.now()
	const shout = group.shout?.body ? String(group.shout.body) : null
	const shoutAt = group.shout?.updated ?? null
	const events: NewEvent[] = [
		{ userId, at: now, kind: "sample", field: "members", after: group.memberCount ?? 0 },
	]

	if (before && shout && (shout !== before.shout || shoutAt !== before.shoutAt)) {
		events.push({
			userId,
			at: Date.parse(shoutAt) || now,
			exact: !!Date.parse(shoutAt),
			kind: "shoutChanged",
			after: {
				body: shout,
				posterId: group.shout.poster?.userId,
				posterName: group.shout.poster?.displayName || group.shout.poster?.username,
			},
		})
	}

	for (const field of ["name", "description"] as const) {
		const value = String(group[field] ?? "")

		if (before && before[field] !== value) {
			events.push({
				userId,
				at: now,
				kind: "profileChanged",
				field,
				before: before[field],
				after: value,
			})
		}
	}

	await setState(`group:${groupId}`, {
		...before,
		name: group.name,
		description: String(group.description ?? ""),
		shout,
		shoutAt,
	})
	await write(events)
}

/** Games a community has published since the last look, by when each was made. */
const checkGroupGames = async (groupId: number) => {
	const json = await getJson(
		`https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=2&limit=50&sortOrder=Desc`,
	)

	if (!Array.isArray(json?.data)) {
		return
	}

	const before = await getState<GroupState>(`group:${groupId}`)

	if (!before) {
		return
	}

	const known = before.games ? new Set(before.games) : null
	await setState(`group:${groupId}`, { ...before, games: json.data.map((game: any) => game.id) })

	if (!known) {
		return
	}

	await write(
		json.data
			.filter((game: any) => !known.has(game.id))
			.map((game: any) => ({
				userId: groupSubject(groupId),
				at: Date.parse(game.created) || Date.now(),
				exact: !!Date.parse(game.created),
				kind: "groupGameAdded",
				after: { id: game.id, name: game.name, placeId: game.rootPlace?.id },
			})),
	)
}

let running = false

const tick = async () => {
	const games = getTrackedGames()
	const groups = getTrackedGroups()

	if (running || (!games.length && !groups.length)) {
		return
	}

	running = true

	try {
		const due = (await getState<Record<string, number>>("trackChecks")) ?? {}
		const now = Date.now()

		if (games.length && now - (due.games ?? 0) >= GAMES_EVERY) {
			due.games = now
			await checkGames(games)
		}

		for (const groupId of groups) {
			if (now - (due[`group:${groupId}`] ?? 0) >= GROUPS_EVERY) {
				due[`group:${groupId}`] = now
				await checkGroup(groupId)
			}

			if (now - (due[`groupGames:${groupId}`] ?? 0) >= GROUP_GAMES_EVERY) {
				due[`groupGames:${groupId}`] = now
				await checkGroupGames(groupId)
			}
		}

		await setState("trackChecks", due)
	} catch (err) {
		console.warn("[btr] tracking check failed", err)
	} finally {
		running = false
	}
}

/** Checks one tracked game or community now, after any round already running. */
export const forceTrackedCheck = async (kind: "game" | "group", id: number): Promise<boolean> => {
	const list = kind === "game" ? getTrackedGames() : getTrackedGroups()

	if (!list.includes(id)) {
		return false
	}

	const busy = () => running

	while (busy()) {
		await new Promise((resolve) => setTimeout(resolve, 500))
	}

	running = true

	try {
		const due = (await getState<Record<string, number>>("trackChecks")) ?? {}

		if (kind === "game") {
			await checkGames([id])
		} else {
			due[`group:${id}`] = Date.now()
			await checkGroup(id)
			due[`groupGames:${id}`] = Date.now()
			await checkGroupGames(id)
		}

		await setState("trackChecks", due)
		return true
	} catch (err) {
		console.warn("[btr] tracking check failed", err)
		return false
	} finally {
		running = false
	}
}

export const startTracking = (): void => {
	setInterval(() => void tick(), 60e3)

	SETTINGS.load(() => {
		void tick()

		// Something just added is looked at straight away, rather than at the
		// next round of checks.
		const checkNew = (key: string) => () =>
			void getState<Record<string, number>>("trackChecks").then(async (due = {}) => {
				if (key === "games") {
					due.games = 0
				} else {
					for (const groupId of getTrackedGroups()) {
						due[`group:${groupId}`] ??= 0
						due[`groupGames:${groupId}`] ??= 0
					}
				}

				await setState("trackChecks", due)
				void tick()
			})

		SETTINGS.onChange("profile.trackedGames", checkNew("games"))
		SETTINGS.onChange("profile.trackedGroups", checkNew("groups"))
	})
}
