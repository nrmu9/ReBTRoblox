import { IS_BACKGROUND_PAGE, STORAGE } from "@/core/env"
import { backgroundScript, contentScript } from "@/core/messaging"
import {
	announceChange,
	checkLevel,
	committed,
	done,
	isFull,
	openDb,
	type PresenceRecord,
	userRange,
} from "@/feat/activityStore"

// What ReBTRoblox has seen each user doing, for the profile's last seen and
// its timeline. Roblox no longer says when someone was last online, so this
// keeps what Roblox's realtime connection pushes, to the background and to
// pages, and the presence pages ask for anyway. Only the background writes it,
// into the activity database, so tabs cannot race.

export type PresenceSegment = Omit<PresenceRecord, "id" | "userId">

interface Observation {
	userId: number
	type: number
	location?: string
	placeId?: number
	gameId?: string
	seen: number
	start?: number
}

// A state seen again after this long without live updates in between may
// have ended and started again unseen, so it starts a new segment.
const GAP = 10 * 60e3

/** Since when the background's live connection has missed nothing, or null while it is down. */
let liveSince: number | null = null

export const setLiveSince = (since: number | null): void => {
	liveSince = since
}

/** Whether friends' presence is arriving live right now. */
export const isLive = (): boolean => liveSince !== null

const sameState = (segment: PresenceSegment, observation: Observation) =>
	segment.type === observation.type &&
	segment.location === observation.location &&
	segment.placeId === observation.placeId &&
	segment.gameId === observation.gameId

// Pages hand what they see to the background, which writes it in order.
let record = (observations: Observation[]) => backgroundScript.send("recordPresences", observations)

if (IS_BACKGROUND_PAGE) {
	let queue = Promise.resolve()

	const apply = async (observations: Observation[]) => {
		if (await isFull()) {
			return
		}

		const db = await openDb()
		const tx = db.transaction("presence", "readwrite")
		const presence = tx.objectStore("presence")
		const changed = new Set<number>()
		const lastByUser = new Map<number, PresenceRecord | null>()

		for (const observation of observations.toSorted((a, b) => a.seen - b.seen)) {
			let last = lastByUser.get(observation.userId)

			if (last === undefined) {
				const cursor = await done(
					presence.index("user").openCursor(userRange(observation.userId), "prev"),
				)
				last = cursor?.value ?? null
			}

			if (!last) {
				// Offline says nothing about someone never seen online.
				if (observation.type === 0) {
					continue
				}
			} else if (
				sameState(last, observation) &&
				(observation.start ||
					observation.seen - last.to < GAP ||
					(liveSince !== null && liveSince <= last.to))
			) {
				last.to = Math.max(last.to, observation.seen)

				// A live start can arrive after a poll already noticed the state.
				if (observation.start && observation.start < last.from) {
					last.from = observation.start
					last.exact = true
				}

				presence.put(last)
				changed.add(observation.userId)
				continue
			} else if (observation.seen < last.to) {
				// Older than what is already known, from a slow response.
				continue
			}

			const next: PresenceRecord = {
				userId: observation.userId,
				type: observation.type,
				from: Math.max(observation.start ?? observation.seen, last?.from ?? 0),
				to: observation.seen,
				...(observation.start ? { exact: true } : {}),
				...(observation.location ? { location: observation.location } : {}),
				...(observation.placeId ? { placeId: observation.placeId } : {}),
				...(observation.gameId ? { gameId: observation.gameId } : {}),
			}

			next.id = (await done(presence.add(next))) as number
			lastByUser.set(observation.userId, next)
			changed.add(observation.userId)
		}

		await committed(tx)

		if (changed.size) {
			announceChange(changed)
		}

		void checkLevel()
	}

	record = (observations) => {
		queue = queue.then(() => apply(observations)).catch((err) => console.error(err))
	}

	// History from before the database, kept in extension storage one key per
	// user, moved over once.
	queue = queue
		.then(async () => {
			const all: Record<string, any> = await new Promise((resolve) => STORAGE.get(null, resolve))
			const keys = Object.keys(all).filter((key) => key.startsWith("presence:"))

			if (!keys.length) {
				return
			}

			const db = await openDb()
			const tx = db.transaction("presence", "readwrite")

			for (const key of keys) {
				for (const segment of all[key] as PresenceSegment[]) {
					tx.objectStore("presence").add({ ...segment, userId: Number(key.slice(9)) })
				}
			}

			await committed(tx)
			await new Promise<void>((resolve) => STORAGE.remove([...keys, "presencePrunedAt"], resolve))
		})
		.catch((err) => console.error("[btr] could not move presence history", err))

	contentScript.listen("recordPresences", (observations: Observation[]) => record(observations))

	contentScript.listen("getPresenceHistory", async (userId: number, respond: (value: any) => void) => {
		const db = await openDb()
		const records = await done(
			db.transaction("presence").objectStore("presence").index("user").getAll(userRange(userId)),
		)

		respond(records.map(({ id: _id, userId: _userId, ...segment }) => segment))
	})

	// When a record's state ended: when the next one began if that was seen
	// live, now if it is still going under the live connection, otherwise the
	// last time it was seen.
	const endOf = async (presence: IDBObjectStore, record: PresenceRecord) => {
		const next = await done(
			presence
				.index("user")
				.openCursor(IDBKeyRange.bound([record.userId, record.from], [record.userId, Infinity], true)),
		)

		if (next) {
			return next.value.exact ? next.value.from : record.to
		}

		return liveSince !== null && record.to >= liveSince ? Date.now() : record.to
	}

	/** Everyone who shared a server with the user while they were both in it, by the user's session start. */
	contentScript.listen("getPlayedTogether", async (userId: number, respond: (value: any) => void) => {
		const db = await openDb()
		const presence = db.transaction("presence").objectStore("presence")
		const sessions = (await done(presence.index("user").getAll(userRange(userId)))).filter(
			(record) => record.gameId,
		)
		const together: Record<number, Array<{ userId: number; from: number; to: number }>> = {}

		for (const session of sessions) {
			const end = await endOf(presence, session)
			const others = (await done(presence.index("game").getAll(session.gameId))).filter(
				(other) => other.userId !== userId,
			)

			for (const other of others) {
				const otherEnd = await endOf(presence, other)

				if (other.from < end && otherEnd > session.from) {
					;(together[session.from] ??= []).push({
						userId: other.userId,
						from: other.from,
						to: otherEnd,
					})
				}
			}
		}

		respond(together)
	})
}

/**
 * Records presences as Roblox's api returns them. `starts` holds the exact
 * start Roblox's realtime connection gives, by user id.
 */
export const recordPresences = (presences: any[], starts?: Record<number, number>): void => {
	const seen = Date.now()
	const observations: Observation[] = []

	for (const presence of presences) {
		const userId = presence?.userId
		const type = presence?.userPresenceType

		// Invisible and anything newer are not states to show.
		if (!Number.isSafeInteger(userId) || !(type >= 0 && type <= 3)) {
			continue
		}

		const start = starts?.[userId]

		observations.push({
			userId,
			type,
			seen,
			// Website and Studio are all Roblox says when it has nothing more.
			...(type >= 2 && !/^(Website|Studio)?$/.test(presence.lastLocation ?? "")
				? { location: String(presence.lastLocation) }
				: {}),
			...(type === 2 && (presence.rootPlaceId || presence.placeId)
				? { placeId: presence.rootPlaceId || presence.placeId }
				: {}),
			...(type === 2 && typeof presence.gameId === "string" && presence.gameId
				? { gameId: presence.gameId }
				: {}),
			// A start in the future or long gone is not one to trust.
			...(start && start <= seen && seen - start < 24 * 60 * 60e3 ? { start } : {}),
		})
	}

	if (observations.length) {
		record(observations)
	}
}

export const getPresenceHistory = (userId: number): Promise<PresenceSegment[]> =>
	new Promise((resolve) => backgroundScript.send("getPresenceHistory", userId, resolve))

export type PlayedTogether = Record<number, Array<{ userId: number; from: number; to: number }>>

/** Who shared a server with the user, by the start of each of their sessions. */
export const getPlayedTogether = (userId: number): Promise<PlayedTogether> =>
	new Promise((resolve) =>
		backgroundScript.send("getPlayedTogether", userId, (value: any) => resolve(value ?? {})),
	)

/** Calls back whenever the activity of any of `userIds` changes, until the returned function is called. */
export const onActivityChange = (userIds: number[], callback: () => void): (() => void) => {
	const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
		const change = changes.activityChanged?.newValue as { users: number[] | null } | undefined

		if (
			areaName === "local" &&
			change &&
			(!change.users || change.users.some((id) => userIds.includes(id)))
		) {
			callback()
		}
	}

	chrome.storage.onChanged.addListener(listener)
	return () => chrome.storage.onChanged.removeListener(listener)
}

/** Calls back with the user's history whenever it changes, until the returned function is called. */
export const onPresenceHistoryChange = (
	userId: number,
	callback: (segments: PresenceSegment[]) => void,
): (() => void) => onActivityChange([userId], () => void getPresenceHistory(userId).then(callback))
