import {
	announceChange,
	committed,
	getState,
	isFull,
	openDb,
	setState,
	type ActivityEvent,
} from "@/feat/activity/store"
import { compareFriendList, namesOf } from "@/feat/activity/friends"
import { isLive, recordPresences } from "@/feat/activity/presence"
import { SETTINGS } from "@/feat/settings"

// People you chose to watch, checked from the background: where they are,
// whose friends they add and lose, and what changes on their profile. Roblox
// only pushes your friends' presence, so for anyone else it is asked for.

const PRESENCE_EVERY = 2 * 60e3
const FRIENDS_EVERY = 60 * 60e3
const PROFILE_EVERY = 4 * 60 * 60e3
const BADGES_EVERY = 60 * 60e3
const FAVORITES_EVERY = 4 * 60 * 60e3
const FOLLOWS_EVERY = 2 * 60 * 60e3
// Followers lists longer than this are only checked for new followers at the
// top, as reading a large account's whole list every few hours is too much.
const FULL_FOLLOW_LIST = 1000

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

	await logChanges(userId, changes)
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

/** Logs profile changes, one event each, at once. */
const logChanges = async (
	userId: number,
	changes: Array<Pick<ActivityEvent, "field" | "before" | "after">>,
) => {
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

/** Every page of a list, or null if any page failed. */
const allPages = async (url: (cursor: string) => string, maxPages: number) => {
	const items: any[] = []
	let cursor = ""

	for (let page = 0; page < maxPages; page++) {
		const json = await getJson(url(cursor))

		if (!json) {
			return null
		}

		items.push(...(json.data ?? []))
		cursor = json.nextPageCursor ?? ""

		if (!cursor) {
			break
		}
	}

	return items
}

// The catalog types the profile's favorites list offers, places aside as
// games are read on their own.
const FAVORITE_TYPES = [8, 24, 3, 13, 18, 19, 17, 40, 10, 12, 38, 11, 2]

interface FavoriteEntry {
	name: string
	placeId?: number
}

interface FavoritesSnapshot {
	games: Record<string, FavoriteEntry>
	/** By catalog type, then asset id. */
	items: Record<string, Record<string, FavoriteEntry>>
}

/**
 * Logs games and catalog items favorited and unfavorited. A list that fails to
 * load keeps what was seen before, so a bad request never reads as everything
 * being unfavorited.
 */
const checkFavorites = async (userId: number) => {
	const before = await getState<FavoritesSnapshot>(`favorites:${userId}`)
	const after: FavoritesSnapshot = { games: before?.games ?? {}, items: { ...before?.items } }

	const games = await allPages(
		(cursor) =>
			`https://games.roblox.com/v2/users/${userId}/favorite/games?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		5,
	)

	if (games) {
		after.games = Object.fromEntries(
			games.map((game: any) => [game.id, { name: game.name, placeId: game.rootPlace?.id }]),
		)
	}

	for (const type of FAVORITE_TYPES) {
		const items = await allPages(
			(cursor) =>
				`https://catalog.roblox.com/v1/favorites/users/${userId}/favorites/${type}/assets?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			3,
		)

		if (items) {
			after.items[type] = Object.fromEntries(items.map((item: any) => [item.id, { name: item.name }]))
		}
	}

	await setState(`favorites:${userId}`, after)

	if (!before) {
		return
	}

	const changes: Array<Pick<ActivityEvent, "field" | "before" | "after">> = []

	const compare = (
		kind: "game" | "item",
		was: Record<string, FavoriteEntry>,
		now: Record<string, FavoriteEntry>,
	) => {
		for (const [id, entry] of Object.entries(now)) {
			if (!(id in was)) {
				changes.push({ field: "favoriteAdded", after: { kind, id: Number(id), ...entry } })
			}
		}

		for (const [id, entry] of Object.entries(was)) {
			if (!(id in now)) {
				changes.push({ field: "favoriteRemoved", before: { kind, id: Number(id), ...entry } })
			}
		}
	}

	compare("game", before.games, after.games)

	for (const type of FAVORITE_TYPES) {
		// A type first read now has nothing to compare against.
		if (before.items[type]) {
			compare("item", before.items[type], after.items[type] ?? {})
		}
	}

	await logChanges(userId, changes)
}

interface FollowsSnapshot {
	followersCount: number
	followingsCount: number
	/** The whole list, or null when it is too long to read each time. */
	followers: number[] | null
	/** The newest followers, which a long list is checked against. */
	recentFollowers: number[]
	followings: number[] | null
}

const followList = (userId: number, list: "followers" | "followings", maxPages: number) =>
	allPages(
		(cursor) =>
			`https://friends.roblox.com/v1/users/${userId}/${list}?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		maxPages,
	).then((items) => items?.map((item: any) => item.id).filter((id: number) => id > 0) ?? null)

/** Logs people who followed and unfollowed, and how the counts changed. */
const checkFollows = async (userId: number) => {
	const [followersCount, followingsCount] = await Promise.all([
		getJson(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
		getJson(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
	]).then((counts) => counts.map((json) => json?.count))

	if (!Number.isSafeInteger(followersCount) || !Number.isSafeInteger(followingsCount)) {
		return
	}

	const fullFollowers = followersCount <= FULL_FOLLOW_LIST
	const followers = await followList(userId, "followers", fullFollowers ? 10 : 2)
	const followings = followingsCount <= FULL_FOLLOW_LIST ? await followList(userId, "followings", 10) : null

	const before = await getState<FollowsSnapshot>(`follows:${userId}`)
	const after: FollowsSnapshot = {
		followersCount,
		followingsCount,
		followers: fullFollowers ? (followers ?? before?.followers ?? null) : null,
		recentFollowers: followers?.slice(0, 200) ?? before?.recentFollowers ?? [],
		followings: followings ?? (followingsCount <= FULL_FOLLOW_LIST ? (before?.followings ?? null) : null),
	}

	await setState(`follows:${userId}`, after)

	if (!before) {
		return
	}

	const counts: Array<Pick<ActivityEvent, "field" | "before" | "after">> = []

	if (before.followersCount !== followersCount) {
		counts.push({ field: "followers", before: before.followersCount, after: followersCount })
	}

	if (before.followingsCount !== followingsCount) {
		counts.push({ field: "followings", before: before.followingsCount, after: followingsCount })
	}

	await logChanges(userId, counts)

	const people: Array<[ActivityEvent["kind"], number]> = []

	const diff = (
		was: number[],
		now: number[],
		added: ActivityEvent["kind"],
		removed: ActivityEvent["kind"],
	) => {
		const wasSet = new Set(was)
		const nowSet = new Set(now)
		people.push(
			...now
				.filter((id) => !wasSet.has(id))
				.map((id) => [added, id] as [ActivityEvent["kind"], number]),
		)
		people.push(
			...was
				.filter((id) => !nowSet.has(id))
				.map((id) => [removed, id] as [ActivityEvent["kind"], number]),
		)
	}

	if (followers && before.followers && after.followers) {
		diff(before.followers, after.followers, "followerAdded", "followerRemoved")
	} else if (followers && before.recentFollowers.length) {
		// Only the top of a long list is read: whoever is above the newest
		// follower seen last time is new. Leaving cannot be seen this way.
		const known = new Set(before.recentFollowers)
		const firstKnown = followers.findIndex((id) => known.has(id))
		people.push(
			...followers
				.slice(0, firstKnown === -1 ? 0 : firstKnown)
				.map((id) => ["followerAdded", id] as [ActivityEvent["kind"], number]),
		)
	}

	if (followings && before.followings) {
		diff(before.followings, followings, "followingAdded", "followingRemoved")
	}

	if (!people.length || (await isFull())) {
		return
	}

	const names = await namesOf(people.map(([, id]) => id))
	const at = Date.now()
	const db = await openDb()
	const tx = db.transaction("events", "readwrite")

	for (const [kind, otherId] of people) {
		tx.objectStore("events").add({ userId, at, kind, otherId, ...names.get(otherId) })
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

	if (running || !SETTINGS.get("profile.lastSeen")) {
		return
	}

	running = true

	try {
		ownUserId ??= (await getJson("https://users.roblox.com/v1/users/authenticated"))?.id ?? null

		if (watched.length && Date.now() - lastPresence >= PRESENCE_EVERY) {
			lastPresence = Date.now()

			// Friends' presence comes live while the connection is up, so only
			// the rest are asked for. Without it, everyone is.
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
			(await getState<
				Record<
					number,
					{
						friends?: number
						profile?: number
						badges?: number
						favorites?: number
						follows?: number
					}
				>
			>("watchChecks")) ?? {}

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

			if (Date.now() - (checks.favorites ?? 0) >= FAVORITES_EVERY) {
				checks.favorites = Date.now()
				await checkFavorites(userId)
				break
			}

			if (Date.now() - (checks.follows ?? 0) >= FOLLOWS_EVERY) {
				checks.follows = Date.now()
				await checkFollows(userId)
				break
			}
		}

		// Your own followers too, with the friend log, so unfollows show up.
		if (ownUserId && SETTINGS.get("profile.friendLog") && !watched.includes(ownUserId)) {
			const checks = (due[ownUserId] ??= {})

			if (Date.now() - (checks.follows ?? 0) >= FOLLOWS_EVERY) {
				checks.follows = Date.now()
				await checkFollows(ownUserId)
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
