import { IS_BACKGROUND_PAGE, STORAGE } from "@/core/env"
import { contentScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"

// Everything the activity features record, in an IndexedDB database the
// background owns. Extension storage caps out at a few megabytes in Chrome,
// and this history is meant to grow for as long as the user keeps it, so
// nothing here is ever deleted except from the settings.

export interface PresenceRecord {
	id?: number
	userId: number
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
	/** The server, which is how playing together is found. */
	gameId?: string
}

// Tracked games and communities keep their events with people's, under ids
// that cannot be a user's: negative, odd for communities and even for games.
export const groupSubject = (groupId: number): number => -(groupId * 2 + 1)
export const gameSubject = (universeId: number): number => -(universeId * 2 + 2)

export interface AvatarItem {
	id: number
	name: string
}

export interface ActivityEvent {
	id?: number
	/** Whose friends list or profile it is. */
	userId: number
	at: number
	/** Seen as it happened, rather than found by comparing lists later. */
	exact?: boolean
	kind:
		| "friendAdded"
		| "friendRemoved"
		| "followerAdded"
		| "followerRemoved"
		| "followingAdded"
		| "followingRemoved"
		| "requestReceived"
		| "requestSent"
		| "requestDeclined"
		| "profileChanged"
		| "sample"
		| "gameUpdated"
		| "shoutChanged"
		| "groupGameAdded"
	/** The friend or follower added or removed, and their names at the time. */
	otherId?: number
	name?: string
	displayName?: string
	field?: string
	before?: unknown
	after?: unknown
	/** For an avatar change, the items put on and taken off. */
	items?: { added: AvatarItem[]; removed: AvatarItem[] }
}

const DB_NAME = "rebtroblox-activity"

let dbPromise: Promise<IDBDatabase> | null = null

export const openDb = (): Promise<IDBDatabase> =>
	(dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 2)

		// Each step brings a database from the version before it up to date.
		req.onupgradeneeded = (ev) => {
			const db = req.result

			if (ev.oldVersion < 1) {
				const presence = db.createObjectStore("presence", { keyPath: "id", autoIncrement: true })
				presence.createIndex("user", ["userId", "from"])
				presence.createIndex("to", "to")

				const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true })
				events.createIndex("user", ["userId", "at"])
				events.createIndex("at", "at")

				// Snapshots compared against to find changes: friend lists, profiles.
				db.createObjectStore("state")
			}

			if (ev.oldVersion < 2) {
				// Who else was in a server, for playing together.
				req.transaction!.objectStore("presence").createIndex("game", "gameId")
			}
		}

		req.onsuccess = () => resolve(req.result)
		req.onerror = () => {
			dbPromise = null
			reject(req.error)
		}
	}))

export const done = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})

export const committed = (tx: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error)
	})

/** Every key from a user's first record to their last, on a [userId, time] index. */
export const userRange = (userId: number) => IDBKeyRange.bound([userId, -Infinity], [userId, Infinity])

export const getState = async <T>(key: string): Promise<T | undefined> => {
	const db = await openDb()
	return done(db.transaction("state").objectStore("state").get(key))
}

export const setState = async (key: string, value: unknown): Promise<void> => {
	const db = await openDb()
	const tx = db.transaction("state", "readwrite")
	tx.objectStore("state").put(value, key)
	await committed(tx)
}

// Usage

const MB = 1024 * 1024

export interface ActivityUsage {
	bytes: number
	/** 0 for no limit. */
	limitBytes: number
	presence: number
	events: number
	oldest: number | null
}

let limitBytes = 250 * MB
let cachedBytes: { bytes: number; at: number } | null = null

export const setLimit = (megabytes: number): void => {
	limitBytes = megabytes > 0 ? megabytes * MB : 0
}

// What the browser says the extension takes on disk, nearly all of it this
// database. Asked at most once a minute, as it is not free.
const usedBytes = async (fresh = false): Promise<number> => {
	if (!fresh && cachedBytes && Date.now() - cachedBytes.at < 60e3) {
		return cachedBytes.bytes
	}

	const estimate = await navigator.storage?.estimate?.().catch(() => null)
	cachedBytes = { bytes: estimate?.usage ?? 0, at: Date.now() }
	return cachedBytes.bytes
}

/** Past the limit nothing new is recorded, until the user clears some or raises it. */
export const isFull = async (): Promise<boolean> => limitBytes > 0 && (await usedBytes()) >= limitBytes

export const getUsage = async (): Promise<ActivityUsage> => {
	const db = await openDb()
	const tx = db.transaction(["presence", "events"])
	const [presence, events, first] = await Promise.all([
		done(tx.objectStore("presence").count()),
		done(tx.objectStore("events").count()),
		done(tx.objectStore("presence").index("to").openCursor()),
	])

	return { bytes: await usedBytes(true), limitBytes, presence, events, oldest: first?.value.to ?? null }
}

/** Lets pages showing someone's activity know to read it again, everyone's with null. */
export const announceChange = (userIds: Iterable<number> | null): void => {
	STORAGE.set({ activityChanged: { users: userIds && [...new Set(userIds)], at: Date.now() } })
}

// Clearing

/** Drops everything last seen before `time`, or everything with no time given. */
export const clearActivity = async (before?: number): Promise<void> => {
	const db = await openDb()
	const tx = db.transaction(["presence", "events", "state"], "readwrite")

	if (before === undefined) {
		tx.objectStore("presence").clear()
		tx.objectStore("events").clear()
		// The friend lists and profiles stay, so changes keep being noticed.
	} else {
		const range = IDBKeyRange.upperBound(before, true)
		tx.objectStore("presence").index("to").openCursor(range).onsuccess = function () {
			const cursor = this.result
			if (cursor) {
				cursor.delete()
				cursor.continue()
			}
		}
		tx.objectStore("events").index("at").openCursor(range).onsuccess = function () {
			const cursor = this.result
			if (cursor) {
				cursor.delete()
				cursor.continue()
			}
		}
	}

	await committed(tx)
	cachedBytes = null
	announceChange(null)
}

export const clearUser = async (userId: number): Promise<void> => {
	const db = await openDb()
	const tx = db.transaction(["presence", "events"], "readwrite")

	for (const name of ["presence", "events"]) {
		tx.objectStore(name).index("user").openCursor(userRange(userId)).onsuccess = function () {
			const cursor = this.result
			if (cursor) {
				cursor.delete()
				cursor.continue()
			}
		}
	}

	await committed(tx)
	cachedBytes = null
	announceChange([userId])
}

/** A user's events, newest first, of the given kinds or all, and from `since` on if given. */
export const getEvents = async (
	userId: number,
	kinds?: string[],
	since = -Infinity,
): Promise<ActivityEvent[]> => {
	const db = await openDb()
	const events: ActivityEvent[] = await done(
		db
			.transaction("events")
			.objectStore("events")
			.index("user")
			.getAll(IDBKeyRange.bound([userId, since], [userId, Infinity])),
	)

	return events.filter((event) => !kinds || kinds.includes(event.kind)).toReversed()
}

/**
 * A page of one store's records, those after the id `after`. Exports go a page
 * at a time, as one message holding all of it can pass what the browser lets
 * a message carry.
 */
export const exportPage = async (store: "presence" | "events", after: number, limit: number) => {
	const db = await openDb()
	return done(db.transaction(store).objectStore(store).getAll(IDBKeyRange.lowerBound(after, true), limit))
}

// Importing a backup

const EVENT_KINDS = new Set<string>([
	"friendAdded",
	"friendRemoved",
	"followerAdded",
	"followerRemoved",
	"followingAdded",
	"followingRemoved",
	"requestReceived",
	"requestSent",
	"requestDeclined",
	"profileChanged",
	"sample",
	"gameUpdated",
	"shoutChanged",
	"groupGameAdded",
])

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** A presence record from a file with only the fields this keeps, or null if it is not one. */
const cleanPresence = (record: any): PresenceRecord | null => {
	if (
		!Number.isSafeInteger(record?.userId) ||
		![0, 1, 2, 3].includes(record.type) ||
		!isTime(record.from) ||
		!isTime(record.to) ||
		record.to < record.from
	) {
		return null
	}

	return {
		userId: record.userId,
		type: record.type,
		from: record.from,
		to: record.to,
		...(record.exact === true ? { exact: true } : {}),
		...(typeof record.location === "string" ? { location: record.location } : {}),
		...(Number.isSafeInteger(record.placeId) ? { placeId: record.placeId } : {}),
		...(typeof record.gameId === "string" ? { gameId: record.gameId } : {}),
	}
}

/** An event from a file without its id, or null if it is not one. */
const cleanEvent = (record: any): ActivityEvent | null => {
	if (!Number.isSafeInteger(record?.userId) || !isTime(record.at) || !EVENT_KINDS.has(record.kind)) {
		return null
	}

	const { id: _id, ...event } = record
	return event
}

const eventKey = (event: ActivityEvent) =>
	JSON.stringify([event.at, event.kind, event.field ?? null, event.otherId ?? null])

/**
 * What one import already holds per person, read once and then kept up as it
 * adds, so a file can come in many pages without reading anyone twice.
 */
const importSeen = new Map<string, { id: string; byUser: Map<number, PresenceRecord[] | Set<string>> }>()

const seenFor = async (importId: string, store: "presence" | "events", userId: number) => {
	let entry = importSeen.get(store)

	if (entry?.id !== importId) {
		entry = { id: importId, byUser: new Map() }
		importSeen.set(store, entry)
	}

	let seen = entry.byUser.get(userId)

	if (!seen) {
		const db = await openDb()
		const records = await done(
			db.transaction(store).objectStore(store).index("user").getAll(userRange(userId)),
		)

		seen =
			store === "presence"
				? (records as PresenceRecord[]).toSorted((a, b) => a.from - b.from)
				: new Set((records as ActivityEvent[]).map(eventKey))

		entry.byUser.set(userId, seen)
	}

	return seen
}

/** Whether `record` covers any time already in `sorted`, which never overlap each other. */
const overlaps = (sorted: PresenceRecord[], record: PresenceRecord) => {
	let low = 0
	let high = sorted.length

	// The first one starting at or after the record ends.
	while (low < high) {
		const mid = (low + high) >> 1
		if (sorted[mid].from < record.to) {
			low = mid + 1
		} else {
			high = mid
		}
	}

	const before = sorted[low - 1]
	return (
		(!!before && before.to > record.from) ||
		(!!sorted[low] && sorted[low].from === record.from && sorted[low].to === record.to)
	)
}

/**
 * Adds a page of a backup's records. Ones already here are skipped, and so is
 * a presence record over time already recorded for that person, which keeps a
 * history from two browsers from showing the same hours twice.
 */
export const importPage = async (
	importId: string,
	store: "presence" | "events",
	records: unknown[],
): Promise<{ added: number; skipped: number; invalid: number }> => {
	let invalid = 0
	const fresh: Array<PresenceRecord | ActivityEvent> = []

	for (const raw of records) {
		const record = store === "presence" ? cleanPresence(raw) : cleanEvent(raw)

		if (!record) {
			invalid++
			continue
		}

		const seen = await seenFor(importId, store, record.userId)

		if (store === "presence") {
			const sorted = seen as PresenceRecord[]
			const presence = record as PresenceRecord

			if (overlaps(sorted, presence)) {
				continue
			}

			const at = sorted.findIndex((other) => other.from > presence.from)
			sorted.splice(at === -1 ? sorted.length : at, 0, presence)
		} else {
			const keys = seen as Set<string>
			const key = eventKey(record as ActivityEvent)

			if (keys.has(key)) {
				continue
			}

			keys.add(key)
		}

		fresh.push(record)
	}

	if (fresh.length) {
		const db = await openDb()
		const tx = db.transaction(store, "readwrite")

		for (const record of fresh) {
			tx.objectStore(store).add(record)
		}

		await committed(tx)
		announceChange(new Set(fresh.map((record) => record.userId)))
	}

	return { added: fresh.length, skipped: records.length - fresh.length - invalid, invalid }
}

// Warnings

/** 0 fine, 1 nearly full, 2 full and no longer recording. */
const levelOf = (bytes: number) =>
	!limitBytes ? 0 : bytes >= limitBytes ? 2 : bytes >= limitBytes * 0.8 ? 1 : 0

let lastLevel = -1

/** Tells pages when the history nears or reaches its limit, so they can say so. */
export const checkLevel = async (fresh = false): Promise<void> => {
	const bytes = await usedBytes(fresh)
	const level = levelOf(bytes)

	if (level !== lastLevel) {
		lastLevel = level
		STORAGE.set({ activityLevel: { level, bytes, limitBytes } })
	}
}

if (IS_BACKGROUND_PAGE) {
	SETTINGS.load(() => {
		const update = () => {
			setLimit(Number(SETTINGS.get("profile.activityLimit")) || 0)
			void checkLevel(true)
		}

		update()
		SETTINGS.onChange("profile.activityLimit", update)
	})

	const answer = (promise: Promise<unknown>, respond: (value: unknown) => void) =>
		promise.then(respond, (err) => {
			console.error(err)
			respond(null)
		})

	contentScript.listen({
		activityUsage(_: unknown, respond: (value: unknown) => void) {
			answer(getUsage(), respond)
		},
		activityClear(before: number | null, respond: (value: unknown) => void) {
			answer(
				clearActivity(before ?? undefined).then(() => checkLevel(true)),
				respond,
			)
		},
		activityClearUser(userId: number, respond: (value: unknown) => void) {
			answer(
				clearUser(userId).then(() => checkLevel(true)),
				respond,
			)
		},
		activityEvents(
			{ userId, kinds, since }: { userId: number; kinds?: string[]; since?: number },
			respond: (value: unknown) => void,
		) {
			answer(getEvents(userId, kinds, since), respond)
		},
		activityExportPage(
			{ store, after, limit }: { store: "presence" | "events"; after: number; limit: number },
			respond: (value: unknown) => void,
		) {
			answer(exportPage(store, after, limit), respond)
		},
		activityImportPage(
			{
				importId,
				store,
				records,
			}: { importId: string; store: "presence" | "events"; records: unknown[] },
			respond: (value: unknown) => void,
		) {
			answer(
				store === "presence" || store === "events"
					? importPage(importId, store, Array.isArray(records) ? records : []).then(
							async (result) => {
								await checkLevel(true)
								return result
							},
						)
					: Promise.resolve(null),
				respond,
			)
		},
	})
}
