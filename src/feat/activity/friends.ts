import {
	announceChange,
	committed,
	getState,
	isFull,
	openDb,
	setState,
	type ActivityEvent,
} from "@/feat/activity/store"

// Friends added and removed, for your own list and for people you watch.
// Live changes come from Roblox's realtime connection; anything that happened
// while nothing was listening is found by comparing the list with the last
// one seen, and timed by when it was noticed.

const listKey = (userId: number) => `friends:${userId}`

// Each change reads a saved list and then writes it, so two at once, such as
// the pair of notifications Roblox can send for one unfriending, would both
// log it. They run one after another instead.
let queue: Promise<unknown> = Promise.resolve()

const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task)
	queue = run.catch(() => {})
	return run
}

/** Names as they are now, kept with each change so a later rename or deletion still reads. */
export const namesOf = async (userIds: number[]) => {
	const names = new Map<number, { name: string; displayName: string }>()

	for (let i = 0; i < userIds.length; i += 100) {
		const res = await fetch("https://users.roblox.com/v1/users", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userIds: userIds.slice(i, i + 100), excludeBannedUsers: false }),
		}).catch(() => null)

		for (const user of res?.ok ? ((await res.json())?.data ?? []) : []) {
			names.set(user.id, { name: user.name, displayName: user.displayName })
		}
	}

	return names
}

const log = async (userId: number, added: number[], removed: number[], exact: boolean) => {
	if (!added.length && !removed.length) {
		return
	}

	if (await isFull()) {
		return
	}

	const names = await namesOf([...added, ...removed])
	const at = Date.now()
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const [kind, ids] of [
		["friendAdded", added],
		["friendRemoved", removed],
	] as const) {
		for (const otherId of ids) {
			const event: ActivityEvent = {
				userId,
				at,
				kind,
				otherId,
				...(exact ? { exact } : {}),
				...names.get(otherId),
			}

			tx.objectStore("events").add(event)
		}
	}

	await committed(tx)
	announceChange([userId])
}

/**
 * Logs how `userId`'s friends changed since the list was last seen. The first
 * list seen for someone only becomes the one to compare against.
 */
const compareNow = async (userId: number, allIds: number[]): Promise<void> => {
	// Friends someone hides from their list come as -1.
	const friendIds = allIds.filter((id) => id > 0)
	const previous = await getState<number[]>(listKey(userId))
	await setState(listKey(userId), friendIds)

	if (!previous) {
		return
	}

	const before = new Set(previous)
	const now = new Set(friendIds)

	await log(
		userId,
		friendIds.filter((id) => !before.has(id)),
		previous.filter((id) => id > 0 && !now.has(id)),
		false,
	)
}

/** A friendship Roblox's realtime connection says was made or ended, as it happened. */
// Friend requests

const REQUESTS_KEY = "requests"

interface Requests {
	/** Requests seen, by the other person, and which way each went. */
	pending: Record<string, "received" | "sent">
}

interface IncomingRequest {
	senderId: number
	sentAt: number
}

/** Requests waiting for you, or null if they could not be read. */
const incomingRequests = async (): Promise<IncomingRequest[] | null> => {
	const requests: IncomingRequest[] = []
	let cursor = ""

	for (let page = 0; page < 5; page++) {
		const json = await fetch(
			`https://friends.roblox.com/v1/my/friends/requests?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			{ credentials: "include" },
		)
			.then((res) => (res.ok ? res.json() : null))
			.catch(() => null)

		if (!json) {
			return null
		}

		for (const entry of json.data ?? []) {
			const request = entry.friendRequest ?? {}

			requests.push({
				senderId: request.senderId ?? entry.id,
				sentAt: Date.parse(request.sentAt) || Date.now(),
			})
		}

		cursor = json.nextPageCursor ?? ""

		if (!cursor) {
			break
		}
	}

	return requests
}

const logRequests = async (
	userId: number,
	entries: Array<{ kind: ActivityEvent["kind"]; otherId: number; at: number; field?: string }>,
) => {
	if (!entries.length || (await isFull())) {
		return
	}

	const names = await namesOf(entries.map((entry) => entry.otherId))
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const entry of entries) {
		tx.objectStore("events").add({ userId, exact: true, ...entry, ...names.get(entry.otherId) })
	}

	await committed(tx)
	announceChange([userId])
}

/**
 * Requests received while nothing was listening, found by comparing the ones
 * waiting with those seen before. Each is logged when it was sent.
 */
const compareRequestsNow = async (ownUserId: number) => {
	const incoming = await incomingRequests()

	if (!incoming) {
		return
	}

	const state = (await getState<Requests>(REQUESTS_KEY)) ?? { pending: {} }
	const first = !(await getState<Requests>(REQUESTS_KEY))
	const fresh = incoming.filter((request) => !state.pending[request.senderId])

	for (const request of incoming) {
		state.pending[request.senderId] = "received"
	}

	await setState(REQUESTS_KEY, state)

	// Those already waiting when this starts are not news.
	if (!first) {
		await logRequests(
			ownUserId,
			fresh.map((request) => ({
				kind: "requestReceived",
				otherId: request.senderId,
				at: request.sentAt,
			})),
		)
	}
}

/** A request sent or declined, which way read from the requests waiting for you and those seen before. */
const onRequestNow = async (ownUserId: number, otherId: number, type: string) => {
	const state = (await getState<Requests>(REQUESTS_KEY)) ?? { pending: {} }

	if (type === "FriendshipRequested") {
		const incoming = await incomingRequests()
		const received = incoming?.find((request) => request.senderId === otherId)

		state.pending[otherId] = received ? "received" : "sent"
		await setState(REQUESTS_KEY, state)
		await logRequests(ownUserId, [
			{
				kind: received ? "requestReceived" : "requestSent",
				otherId,
				at: received?.sentAt ?? Date.now(),
			},
		])
	} else {
		const direction = state.pending[otherId]
		delete state.pending[otherId]
		await setState(REQUESTS_KEY, state)
		await logRequests(ownUserId, [
			{
				kind: "requestDeclined",
				otherId,
				at: Date.now(),
				...(direction ? { field: direction === "received" ? "byYou" : "byThem" } : {}),
			},
		])
	}
}

const onFriendshipNow = async (ownUserId: number, notification: any): Promise<void> => {
	const added = notification?.Type === "FriendshipCreated"
	const removed = notification?.Type === "FriendshipDestroyed"
	const { UserId1, UserId2 } = notification?.EventArgs ?? {}
	const otherId = UserId1 === ownUserId ? UserId2 : UserId2 === ownUserId ? UserId1 : null

	if (!Number.isSafeInteger(otherId)) {
		return
	}

	if (notification?.Type === "FriendshipRequested" || notification?.Type === "FriendshipDeclined") {
		await onRequestNow(ownUserId, otherId, notification.Type)
		return
	}

	if (!added && !removed) {
		return
	}

	// A request that became a friendship is no longer waiting.
	if (added) {
		const state = await getState<Requests>(REQUESTS_KEY)

		if (state?.pending[otherId]) {
			delete state.pending[otherId]
			await setState(REQUESTS_KEY, state)
		}
	}

	// The saved list follows, so the next comparison does not log it again.
	const list = new Set((await getState<number[]>(listKey(ownUserId))) ?? [])

	if (added === list.has(otherId)) {
		return
	}

	if (added) {
		list.add(otherId)
	} else {
		list.delete(otherId)
	}

	await setState(listKey(ownUserId), [...list])
	await log(ownUserId, added ? [otherId] : [], removed ? [otherId] : [], true)
}

export const compareFriendList = (userId: number, friendIds: number[]): Promise<void> =>
	inOrder(() => compareNow(userId, friendIds))

export const onFriendshipChanged = (ownUserId: number, notification: any): Promise<void> =>
	inOrder(() => onFriendshipNow(ownUserId, notification))

export const compareRequests = (ownUserId: number): Promise<void> =>
	inOrder(() => compareRequestsNow(ownUserId))
