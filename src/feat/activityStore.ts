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

export interface ActivityEvent {
	id?: number
	/** Whose friends list or profile it is. */
	userId: number
	at: number
	/** Seen as it happened, rather than found by comparing lists later. */
	exact?: boolean
	kind: "friendAdded" | "friendRemoved" | "profileChanged"
	/** The friend added or removed. */
	otherId?: number
	field?: string
	before?: unknown
	after?: unknown
}

const DB_NAME = "rebtroblox-activity"

let dbPromise: Promise<IDBDatabase> | null = null

export const openDb = (): Promise<IDBDatabase> =>
	(dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1)

		req.onupgradeneeded = () => {
			const db = req.result

			const presence = db.createObjectStore("presence", { keyPath: "id", autoIncrement: true })
			presence.createIndex("user", ["userId", "from"])
			presence.createIndex("to", "to")

			const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true })
			events.createIndex("user", ["userId", "at"])
			events.createIndex("at", "at")

			// Snapshots compared against to find changes: friend lists, profiles.
			db.createObjectStore("state")
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

export const exportActivity = async () => {
	const db = await openDb()
	const tx = db.transaction(["presence", "events"])

	return {
		exportedAt: new Date().toISOString(),
		presence: await done(tx.objectStore("presence").getAll()),
		events: await done(tx.objectStore("events").getAll()),
	}
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
		activityExport(_: unknown, respond: (value: unknown) => void) {
			answer(exportActivity(), respond)
		},
	})
}
