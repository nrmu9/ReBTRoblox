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
const namesOf = async (userIds: number[]) => {
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
const onFriendshipNow = async (ownUserId: number, notification: any): Promise<void> => {
	const added = notification?.Type === "FriendshipCreated"
	const removed = notification?.Type === "FriendshipDestroyed"
	const { UserId1, UserId2 } = notification?.EventArgs ?? {}
	const otherId = UserId1 === ownUserId ? UserId2 : UserId2 === ownUserId ? UserId1 : null

	if ((!added && !removed) || !Number.isSafeInteger(otherId)) {
		return
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
