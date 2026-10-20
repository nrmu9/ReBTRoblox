import { IS_BACKGROUND_PAGE, STORAGE } from "@/core/env"
import { backgroundScript, contentScript } from "@/core/messaging"

// What ReBTRoblox has seen each user doing, for the profile's last seen and
// its timeline. Roblox no longer says when someone was last online, so this
// keeps what Roblox's realtime connection pushes, to the background and to
// pages, and the presence pages ask for anyway. It lives in extension storage,
// out of Roblox's own localStorage, and only the background writes it so tabs
// cannot race.

export interface PresenceSegment {
	/** 0 offline, 1 on the website, 2 in an experience, 3 in Studio. */
	type: number
	/** When this state was first and last seen, epoch ms. */
	from: number
	to: number
	/** The start is when it happened rather than when it was noticed. */
	exact?: boolean
	/** Experience or Studio place name. */
	location?: string
	placeId?: number
}

interface Observation {
	userId: number
	type: number
	location?: string
	placeId?: number
	seen: number
	start?: number
}

const KEY_PREFIX = "presence:"
const SEGMENT_LIMIT = 30
const USER_LIMIT = 600
const MAX_AGE = 90 * 24 * 60 * 60e3

// A state seen again after this long without live updates in between may
// have ended and started again unseen, so it starts a new segment.
const GAP = 10 * 60e3

const storageKey = (userId: number) => KEY_PREFIX + userId

/** Since when the background's live connection has missed nothing, or null while it is down. */
let liveSince: number | null = null

export const setLiveSince = (since: number | null): void => {
	liveSince = since
}

const sameState = (segment: PresenceSegment, observation: Observation) =>
	segment.type === observation.type &&
	segment.location === observation.location &&
	segment.placeId === observation.placeId

// Pages hand what they see to the background, which writes it in order.
let record = (observations: Observation[]) => backgroundScript.send("recordPresences", observations)

if (IS_BACKGROUND_PAGE) {
	let queue = Promise.resolve()

	const apply = async (observations: Observation[]) => {
		const keys = [...new Set(observations.map((observation) => storageKey(observation.userId)))]
		const stored = await new Promise<Record<string, PresenceSegment[]>>((resolve) =>
			STORAGE.get(keys, (data) => resolve(data as Record<string, PresenceSegment[]>)),
		)
		const changed: Record<string, PresenceSegment[]> = {}

		for (const observation of observations) {
			const key = storageKey(observation.userId)
			const segments = changed[key] ?? stored[key] ?? []
			const last = segments.at(-1)

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

				changed[key] = segments
				continue
			} else if (observation.seen < last.to) {
				// Older than what is already known, from a slow response.
				continue
			}

			const from = Math.max(observation.start ?? observation.seen, last?.from ?? 0)

			segments.push({
				type: observation.type,
				from,
				to: observation.seen,
				...(observation.start ? { exact: true } : {}),
				...(observation.location ? { location: observation.location } : {}),
				...(observation.placeId ? { placeId: observation.placeId } : {}),
			})

			changed[key] = segments.slice(-SEGMENT_LIMIT)
		}

		if (Object.keys(changed).length) {
			await new Promise<void>((resolve) => STORAGE.set(changed, resolve))
		}
	}

	// Drops users not seen in a long time, and the oldest past the limit, at
	// most once a day.
	const prune = async () => {
		const all: Record<string, any> = await new Promise((resolve) => STORAGE.get(null, resolve))

		if (Date.now() - (all.presencePrunedAt ?? 0) < 24 * 60 * 60e3) {
			return
		}

		const users = Object.entries(all)
			.filter(([key]) => key.startsWith(KEY_PREFIX))
			.map(([key, segments]: [string, PresenceSegment[]]) => [key, segments.at(-1)?.to ?? 0] as const)
			.toSorted((a, b) => b[1] - a[1])

		const stale = users
			.filter(([, to], index) => index >= USER_LIMIT || Date.now() - to > MAX_AGE)
			.map(([key]) => key)

		await new Promise<void>((resolve) => STORAGE.remove(stale, resolve))
		await new Promise<void>((resolve) => STORAGE.set({ presencePrunedAt: Date.now() }, resolve))
	}

	record = (observations) => {
		queue = queue
			.then(() => apply(observations))
			.then(prune)
			.catch((err) => console.error(err))
	}

	contentScript.listen("recordPresences", (observations: Observation[]) => record(observations))
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
			// A start in the future or long gone is not one to trust.
			...(start && start <= seen && seen - start < 24 * 60 * 60e3 ? { start } : {}),
		})
	}

	if (observations.length) {
		record(observations)
	}
}

export const getPresenceHistory = (userId: number): Promise<PresenceSegment[]> =>
	new Promise((resolve) => {
		const key = storageKey(userId)
		STORAGE.get(key, (data) => resolve((data?.[key] as PresenceSegment[]) ?? []))
	})

/** Calls back with the user's history whenever it changes, until the returned function is called. */
export const onPresenceHistoryChange = (
	userId: number,
	callback: (segments: PresenceSegment[]) => void,
): (() => void) => {
	const key = storageKey(userId)

	const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
		if (areaName === "local" && changes[key]) {
			callback((changes[key].newValue as PresenceSegment[]) ?? [])
		}
	}

	chrome.storage.onChanged.addListener(listener)
	return () => chrome.storage.onChanged.removeListener(listener)
}
