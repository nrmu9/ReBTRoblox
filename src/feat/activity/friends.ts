import { delay } from "@/core/util"
import { userNames } from "@/feat/activity/users"
import {
	announceChange,
	committed,
	done,
	getState,
	isFull,
	openDb,
	setState,
	type ActivityEvent,
} from "@/feat/activity/store"
import { RobloxApi } from "@/rbx/RobloxApi"

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

/** `field` says who did it, when that is known. */
const log = async (
	userId: number,
	added: number[],
	removed: number[],
	exact: boolean,
	field?: string | null,
) => {
	if (!added.length && !removed.length) {
		return
	}

	if (await isFull()) {
		return
	}

	const names = await userNames([...added, ...removed])
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
				...(field ? { field } : {}),
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

	const names = await userNames(entries.map((entry) => entry.otherId))
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const entry of entries) {
		tx.objectStore("events").add({ userId, exact: true, ...entry, ...names.get(entry.otherId) })
	}

	await committed(tx)
	announceChange([userId])
}

/** Puts right the newest request with someone in the last day, when it was logged the wrong way round. */
const correctRequest = async (
	ownUserId: number,
	otherId: number,
	kind: "requestReceived" | "requestSent",
	at: number,
) => {
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")
	const events = tx.objectStore("events")
	const recent: ActivityEvent[] = await done(
		events
			.index("user")
			.getAll(IDBKeyRange.bound([ownUserId, Date.now() - 24 * 60 * 60e3], [ownUserId, Infinity])),
	)
	const logged = recent
		.toReversed()
		.find(
			(event) =>
				event.otherId === otherId &&
				(event.kind === "requestReceived" || event.kind === "requestSent"),
		)

	if (logged && logged.kind !== kind) {
		events.put({ ...logged, kind, at })
	}

	await committed(tx)
	announceChange([ownUserId])
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
	// Logged as yours, though it is waiting for you: a live event got there first.
	const mistaken = incoming.filter((request) => state.pending[request.senderId] === "sent")

	for (const request of incoming) {
		state.pending[request.senderId] = "received"
	}

	await setState(REQUESTS_KEY, state)

	for (const request of mistaken) {
		await correctRequest(ownUserId, request.senderId, "requestReceived", request.sentAt)
	}

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

// Who ended something. Roblox's events only say that a request or friendship
// ended, and blocking ends both, so what you do in this browser is noted as it
// happens, and anything else is checked against whether either of you blocked
// the other. What is still unknown after that is logged as unknown.

/** Friend actions you took here lately, by the other person. */
const ownActions = new Map<number, { action: string; at: number }>()
let declinedAllAt = 0
const OWN_WINDOW = 2 * 60e3

export const noteOwnAction = (otherId: number, action: string): void => {
	if (action === "declineAll") {
		declinedAllAt = Date.now()
	} else if (Number.isSafeInteger(otherId)) {
		ownActions.set(otherId, { action, at: Date.now() })
	}
}

const recentOwn = (otherId: number) => {
	const own = ownActions.get(otherId)
	return own && Date.now() - own.at < OWN_WINDOW ? own.action : null
}

/**
 * Whether either of you blocked the other, from what their profile offers:
 * Unblock when you did it, and no About and no way to add them when they did.
 */
const blockBetween = async (otherId: number): Promise<"blockedYou" | "blockedByYou" | null> => {
	// The profile can lag the event that a block caused.
	await delay(1500)

	const json = await RobloxApi.userProfiles.getComponents(otherId, ["About", "Actions"]).catch(() => null)
	const actions = json?.components?.Actions

	if (!actions) {
		return null
	}

	if (actions.contextual?.includes?.("Unblock")) {
		return "blockedByYou"
	}

	if (
		!json.components.About &&
		actions.buttons?.some?.((button: any) => button?.type === "CannotAddFriend")
	) {
		return "blockedYou"
	}

	return null
}

/** How something between you and `otherId` ended: by you here, by a block, or not known. */
const endedBy = async (otherId: number, yours: string) => {
	const own = recentOwn(otherId)

	if (own === yours) {
		return "you"
	}

	if (own === "block") {
		return "blockedByYou"
	}

	return blockBetween(otherId)
}

/** A request sent or ended, which way read from the requests waiting for you and those seen before. */
const onRequestNow = async (ownUserId: number, otherId: number, type: string) => {
	const state = (await getState<Requests>(REQUESTS_KEY)) ?? { pending: {} }

	if (type === "FriendshipRequested") {
		const findIncoming = async () =>
			(await incomingRequests())?.find((request) => request.senderId === otherId) ?? null

		// Their request waiting for you says it was theirs, even when you just
		// pressed Add Friend, which accepts it through the same request. Roblox's
		// list can lag its own event, so it is asked again before the request is
		// put down as yours, unless you sent it from here.
		let received = await findIncoming()

		if (recentOwn(otherId) !== "request") {
			for (const wait of [2000, 5000]) {
				if (received) {
					break
				}

				await delay(wait)
				received = await findIncoming()
			}
		}

		const direction = received ? "received" : "sent"
		const kind = received ? "requestReceived" : "requestSent"
		const at = received?.sentAt ?? Date.now()
		const before = state.pending[otherId]

		state.pending[otherId] = direction
		await setState(REQUESTS_KEY, state)

		// Roblox can send the same event twice: logged once, and put right if
		// the first look had it the wrong way round.
		if (!before) {
			await logRequests(ownUserId, [{ kind, otherId, at }])
		} else if (before !== direction) {
			await correctRequest(ownUserId, otherId, kind, at)
		}
	} else {
		const direction = state.pending[otherId]
		delete state.pending[otherId]
		await setState(REQUESTS_KEY, state)

		const at = Date.now()
		const declinedAll = direction === "received" && at - declinedAllAt < OWN_WINDOW
		// A request you sent that ended without a block was declined. One you
		// received that you did not decline here ended some other way, such as
		// in the app, so it is not put down to you.
		const field =
			(declinedAll ? "you" : await endedBy(otherId, "decline")) ??
			(direction === "sent" ? "them" : direction === "received" ? "ended" : null)

		await logRequests(ownUserId, [{ kind: "requestDeclined", otherId, at, ...(field ? { field } : {}) }])
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

	// A request that became a friendship is no longer waiting, and which way
	// it went says who accepted.
	let field: string | null = null

	if (added) {
		const state = await getState<Requests>(REQUESTS_KEY)
		const direction = state?.pending[otherId]

		if (state && direction) {
			field = direction === "received" ? "you" : "them"
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

	if (removed) {
		field = await endedBy(otherId, "unfriend")
	}

	await log(ownUserId, added ? [otherId] : [], removed ? [otherId] : [], true, field)
}

export const compareFriendList = (userId: number, friendIds: number[]): Promise<void> =>
	inOrder(() => compareNow(userId, friendIds))

export const onFriendshipChanged = (ownUserId: number, notification: any): Promise<void> =>
	inOrder(() => onFriendshipNow(ownUserId, notification))

export const compareRequests = (ownUserId: number): Promise<void> =>
	inOrder(() => compareRequestsNow(ownUserId))
