import {
	announceChange,
	committed,
	getState,
	isFull,
	openDb,
	setState,
	type ActivityEvent,
} from "@/feat/activity/store"
import { compareFriendList } from "@/feat/activity/friends"
import { isLive, recordPresences } from "@/feat/activity/presence"
import { SETTINGS } from "@/feat/settings"

// People you chose to watch, checked from the background: where they are,
// whose friends they add and lose, and what changes on their profile. Roblox
// only pushes your friends' presence, so for anyone else it is asked for.

const PRESENCE_EVERY = 2 * 60e3
const FRIENDS_EVERY = 60 * 60e3
const PROFILE_EVERY = 4 * 60 * 60e3
const BADGES_EVERY = 60 * 60e3

export const getWatchedUsers = (): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get("profile.watchedUsers") || "[]")
		return Array.isArray(list) ? list.filter((id) => Number.isSafeInteger(id) && id > 0) : []
	} catch {
		return []
	}
}

const getJson = (url: string) =>
	fetch(url, { credentials: "include" })
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null)

/** All of someone's friends, or null if any page failed, which would read as removals. */
const friendsOf = async (userId: number): Promise<number[] | null> => {
	const ids: number[] = []
	let cursor = ""

	do {
		const page = await getJson(
			`https://friends.roblox.com/v1/users/${userId}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		)

		if (!page) {
			return null
		}

		ids.push(...(page.PageItems ?? []).map((item: any) => item.id))
		cursor = page.NextCursor ?? ""
	} while (cursor)

	return ids
}

interface ProfileSnapshot {
	name: string
	displayName: string
	description: string
	isBanned: boolean
	/** The avatar image's address, whose hash changes with the avatar. */
	avatar: string | null
	groups: Record<string, string>
}

const avatarHash = (url: string | null) => url?.match(/-([0-9A-F]{32})-/i)?.[1] ?? url

const profileOf = async (userId: number): Promise<ProfileSnapshot | null> => {
	const [user, avatar, groups] = await Promise.all([
		getJson(`https://users.roblox.com/v1/users/${userId}`),
		getJson(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=150x150&format=Png`),
		getJson(`https://groups.roblox.com/v2/users/${userId}/groups/roles?includeLocked=true`),
	])

	if (!user?.name || !groups) {
		return null
	}

	return {
		name: user.name,
		displayName: user.displayName,
		description: user.description ?? "",
		isBanned: !!user.isBanned,
		avatar: avatar?.data?.[0]?.state === "Completed" ? avatar.data[0].imageUrl : null,
		groups: Object.fromEntries(
			(groups.data ?? []).map((entry: any) => [entry.group.id, entry.group.name]),
		),
	}
}

/** Logs what differs between two looks at a profile, one event per change. */
const compareProfile = async (userId: number, before: ProfileSnapshot, after: ProfileSnapshot) => {
	const changes: Array<Pick<ActivityEvent, "field" | "before" | "after">> = []

	for (const field of ["name", "displayName", "description", "isBanned"] as const) {
		if (before[field] !== after[field]) {
			changes.push({ field, before: before[field], after: after[field] })
		}
	}

	// A render that failed says nothing about the avatar.
	if (before.avatar && after.avatar && avatarHash(before.avatar) !== avatarHash(after.avatar)) {
		changes.push({ field: "avatar", before: before.avatar, after: after.avatar })
	}

	for (const [id, name] of Object.entries(after.groups)) {
		if (!(id in before.groups)) {
			changes.push({ field: "groupJoined", after: { id: Number(id), name } })
		}
	}

	for (const [id, name] of Object.entries(before.groups)) {
		if (!(id in after.groups)) {
			changes.push({ field: "groupLeft", before: { id: Number(id), name } })
		}
	}

	if (!changes.length || (await isFull())) {
		return
	}

	const at = Date.now()
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const change of changes) {
		tx.objectStore("events").add({ userId, at, kind: "profileChanged", ...change })
	}

	await committed(tx)
	announceChange([userId])
}

const checkProfile = async (userId: number) => {
	const after = await profileOf(userId)

	if (!after) {
		return
	}

	const before = await getState<ProfileSnapshot>(`profile:${userId}`)

	// An avatar that failed to render keeps the last one, so it is not seen
	// as changed twice.
	await setState(`profile:${userId}`, { ...after, avatar: after.avatar ?? before?.avatar ?? null })

	if (before) {
		await compareProfile(userId, before, after)
	}
}

interface BadgeSnapshot {
	ids: number[]
	checkedAt: number
}

/**
 * Logs badges earned since the last look, at the time each was awarded. The
 * newest hundred are compared, and only those awarded after the last look
 * count, so a badge someone deletes, which lets an older one into the
 * hundred, does not read as new. A hidden inventory lists none and is skipped.
 */
const checkBadges = async (userId: number) => {
	const list = await getJson(`https://badges.roblox.com/v1/users/${userId}/badges?limit=100&sortOrder=Desc`)

	if (!Array.isArray(list?.data) || !list.data.length) {
		return
	}

	const before = await getState<BadgeSnapshot>(`badges:${userId}`)
	const now = Date.now()
	await setState(`badges:${userId}`, { ids: list.data.map((badge: any) => badge.id), checkedAt: now })

	if (!before) {
		return
	}

	const known = new Set(before.ids)
	const fresh = list.data.filter((badge: any) => !known.has(badge.id))

	if (!fresh.length || (await isFull())) {
		return
	}

	const dates = await getJson(
		`https://badges.roblox.com/v1/users/${userId}/badges/awarded-dates?badgeIds=${fresh.map((badge: any) => badge.id).join(",")}`,
	)
	const awardedAt = new Map<number, number>(
		(dates?.data ?? []).map((entry: any) => [entry.badgeId, Date.parse(entry.awardedDate)]),
	)

	const earned = fresh.filter((badge: any) => (awardedAt.get(badge.id) ?? 0) > before.checkedAt)

	if (!earned.length) {
		return
	}

	// The game each was earned in, by the place that awarded it.
	const placeIds = [...new Set(earned.map((badge: any) => badge.awarder?.id).filter(Boolean))]
	const places = await getJson(
		`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeIds.join(",")}`,
	)
	const gameNames = new Map<number, string>(
		(Array.isArray(places) ? places : []).map((place: any) => [place.placeId, place.name]),
	)

	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const badge of earned) {
		const placeId = badge.awarder?.id
		const event: ActivityEvent = {
			userId,
			at: awardedAt.get(badge.id)!,
			exact: true,
			kind: "profileChanged",
			field: "badge",
			after: {
				id: badge.id,
				name: badge.displayName || badge.name,
				...(placeId ? { placeId, gameName: gameNames.get(placeId) } : {}),
			},
		}

		tx.objectStore("events").add(event)
	}

	await committed(tx)
	announceChange([userId])
}

const checkFriends = async (userId: number) => {
	const ids = await friendsOf(userId)

	if (ids) {
		await compareFriendList(userId, ids)
	}
}

// One tick a minute does whatever is due, so a dozen watched people never
// means a dozen requests at once.
let lastPresence = 0
let running = false
let ownUserId: number | null = null

const tick = async () => {
	const watched = getWatchedUsers()

	if (running || !watched.length || !SETTINGS.get("profile.lastSeen")) {
		return
	}

	running = true

	try {
		if (Date.now() - lastPresence >= PRESENCE_EVERY) {
			lastPresence = Date.now()

			// Friends' presence comes live while the connection is up, so only
			// the rest are asked for. Without it, everyone is.
			ownUserId ??= (await getJson("https://users.roblox.com/v1/users/authenticated"))?.id ?? null
			const friends = new Set(
				(isLive() && ownUserId && (await getState<number[]>(`friends:${ownUserId}`))) || [],
			)
			const ids = watched.filter((id) => !friends.has(id))

			if (ids.length) {
				const res = await fetch("https://presence.roblox.com/v1/presence/users", {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ userIds: ids }),
				}).catch(() => null)

				if (res?.ok) {
					recordPresences((await res.json())?.userPresences ?? [])
				}
			}
		}

		const due =
			(await getState<Record<number, { friends?: number; profile?: number; badges?: number }>>(
				"watchChecks",
			)) ?? {}

		for (const userId of watched) {
			const checks = (due[userId] ??= {})

			if (Date.now() - (checks.friends ?? 0) >= FRIENDS_EVERY) {
				checks.friends = Date.now()
				await checkFriends(userId)
				break
			}

			if (Date.now() - (checks.profile ?? 0) >= PROFILE_EVERY) {
				checks.profile = Date.now()
				await checkProfile(userId)
				break
			}

			if (Date.now() - (checks.badges ?? 0) >= BADGES_EVERY) {
				checks.badges = Date.now()
				await checkBadges(userId)
				break
			}
		}

		await setState("watchChecks", due)
	} catch (err) {
		console.warn("[btr] watch check failed", err)
	} finally {
		running = false
	}
}

export const startWatching = (): void => {
	setInterval(() => void tick(), 60e3)

	SETTINGS.load(() => {
		void tick()
		// Someone just added is looked at straight away.
		SETTINGS.onChange("profile.watchedUsers", () => void tick())
	})
}
