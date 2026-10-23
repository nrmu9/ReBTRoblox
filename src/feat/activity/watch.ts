import { delay, getJson } from "@/core/util"
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
import { userNames } from "@/feat/activity/users"
import { isLive, latestPresence, recordPresences } from "@/feat/activity/presence"
import { SETTINGS } from "@/feat/settings"
import { forceTrackedCheck } from "@/feat/activity/tracked"
import { listIds } from "@/feat/activity/lists"
import { contentScript } from "@/core/messaging"
import {
	avatarHash,
	earnedSince,
	listDiff,
	newAtTop,
	profileChanges,
	wearingDiff,
	type ProfileSnapshot,
} from "@/feat/activity/diff"
import { CHECK_KINDS, mostOverdue, type CheckKind, type WatchChecks } from "@/feat/activity/schedule"

// People you chose to watch, checked from the background: where they are,
// whose friends they add and lose, and what changes on their profile. Roblox
// only pushes your friends' presence, so for anyone else it is asked for.

const PRESENCE_EVERY = 2 * 60e3
// Names and avatars of everyone at once, in two requests.
const QUICK_EVERY = 5 * 60e3
const FOLLOWS_EVERY = 2 * 60 * 60e3
// Opening someone's profile or activity runs any check older than this.
const REFRESH_OLDER = 10 * 60e3
const REFRESH_FAVORITES_OLDER = 60 * 60e3
const CHECKS_PER_TICK = 3

// Followers lists longer than this are only checked for new followers at the
// top, as reading a large account's whole list every few hours is too much.
const FULL_FOLLOW_LIST = 1000

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

const wearingOf = (userId: number): Promise<number[] | null> =>
	getJson(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`).then((json) =>
		Array.isArray(json?.assetIds) ? json.assetIds : null,
	)

/** Item names, from the catalog, which wants a token it hands out on the first refusal. */
const itemNames = async (assetIds: number[]): Promise<Map<number, string>> => {
	const names = new Map<number, string>()

	for (let i = 0; i < assetIds.length; i += 100) {
		const body = JSON.stringify({
			items: assetIds.slice(i, i + 100).map((id) => ({ itemType: "Asset", id })),
		})
		const post = (token?: string) =>
			fetch("https://catalog.roblox.com/v1/catalog/items/details", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-TOKEN": token } : {}) },
				body,
			}).catch(() => null)

		let res = await post()
		const token = res?.status === 403 ? res.headers.get("x-csrf-token") : null

		if (token) {
			res = await post(token)
		}

		for (const item of res?.ok ? ((await res.json())?.data ?? []) : []) {
			names.set(item.id, item.name)
		}
	}

	return names
}

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
			(groups.data ?? []).map((entry: any) => [
				entry.group.id,
				{ name: entry.group.name, role: entry.role?.name ?? "", rank: entry.role?.rank ?? 0 },
			]),
		),
	}
}

/** Logs what differs between two looks at a profile, one event per change. */
const compareProfile = async (userId: number, before: ProfileSnapshot, after: ProfileSnapshot) => {
	const worn = wearingDiff(before, after)
	const names = worn ? await itemNames([...worn.added, ...worn.removed]) : undefined

	await logChanges(userId, profileChanges(before, after, names))
}

const checkProfile = async (userId: number) => {
	const after = await profileOf(userId)

	if (!after) {
		return
	}

	const before = await getState<ProfileSnapshot>(`profile:${userId}`)

	// What they wear is read when the avatar looks different, and once to
	// start from, rather than on every check.
	const avatarChanged =
		!before?.avatar || (after.avatar && avatarHash(before.avatar) !== avatarHash(after.avatar))
	const wearing = (avatarChanged ? await wearingOf(userId) : null) ?? before?.wearing

	if (wearing) {
		after.wearing = wearing
	}

	// An avatar that failed to render keeps the last one, so it is not seen
	// as changed twice.
	await setState(`profile:${userId}`, { ...after, avatar: after.avatar ?? before?.avatar ?? null })

	if (before) {
		await compareProfile(userId, before, after)
	}
}

/**
 * Who of these has a new name, display name or avatar, from two requests for
 * everyone, so their full profile is looked at within minutes rather than hours.
 */
const quickCheck = async (userIds: number[]): Promise<number[]> => {
	const changed = new Set<number>()

	for (let i = 0; i < userIds.length; i += 100) {
		const ids = userIds.slice(i, i + 100)
		const [users, avatars, snapshots] = await Promise.all([
			fetch("https://users.roblox.com/v1/users", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userIds: ids, excludeBannedUsers: false }),
			})
				.then((res) => (res.ok ? res.json() : null))
				.catch(() => null),
			getJson(
				`https://thumbnails.roblox.com/v1/users/avatar?userIds=${ids.join(",")}&size=150x150&format=Png`,
			),
			Promise.all(ids.map((id) => getState<ProfileSnapshot>(`profile:${id}`))),
		])

		const before = new Map(ids.map((id, index) => [id, snapshots[index]]))

		for (const user of users?.data ?? []) {
			const snapshot = before.get(user.id)

			if (snapshot && (snapshot.name !== user.name || snapshot.displayName !== user.displayName)) {
				changed.add(user.id)
			}
		}

		for (const thumb of avatars?.data ?? []) {
			const snapshot = before.get(thumb.targetId)

			if (
				thumb.state === "Completed" &&
				snapshot?.avatar &&
				avatarHash(snapshot.avatar) !== avatarHash(thumb.imageUrl)
			) {
				changed.add(thumb.targetId)
			}
		}
	}

	return [...changed]
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

	const fresh = listDiff(
		before.ids,
		list.data.map((badge: any) => badge.id),
	).added

	if (!fresh.length || (await isFull())) {
		return
	}

	const dates = await getJson(
		`https://badges.roblox.com/v1/users/${userId}/badges/awarded-dates?badgeIds=${fresh.join(",")}`,
	)
	const awardedAt = new Map<number, number>(
		(dates?.data ?? []).map((entry: any) => [entry.badgeId, Date.parse(entry.awardedDate)]),
	)

	const earned = earnedSince<any>(list.data, before.ids, awardedAt, before.checkedAt)

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
	changes: Array<Pick<ActivityEvent, "field" | "before" | "after" | "items">>,
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
		const change = listDiff(was, now)
		people.push(...change.added.map((id) => [added, id] as [ActivityEvent["kind"], number]))
		people.push(...change.removed.map((id) => [removed, id] as [ActivityEvent["kind"], number]))
	}

	if (followers && before.followers && after.followers) {
		diff(before.followers, after.followers, "followerAdded", "followerRemoved")
	} else if (followers && before.recentFollowers.length) {
		// Only the top of a long list is read. Leaving cannot be seen this way.
		people.push(
			...newAtTop(before.recentFollowers, followers).map(
				(id) => ["followerAdded", id] as [ActivityEvent["kind"], number],
			),
		)
	}

	if (followings && before.followings) {
		diff(before.followings, followings, "followingAdded", "followingRemoved")
	}

	if (!people.length || (await isFull())) {
		return
	}

	const names = await userNames(people.map(([, id]) => id))
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

const CHECKS: Record<CheckKind, (userId: number) => Promise<void>> = {
	friends: checkFriends,
	profile: checkProfile,
	badges: checkBadges,
	favorites: checkFavorites,
	follows: checkFollows,
}

// One tick a minute does the few checks most overdue, so a dozen watched
// people never means a dozen requests at once.
let lastPresence = 0
let lastQuick = 0
let ownUserId: number | null = null

// Ticks and refreshes take turns, as both rewrite when each check last ran.
let turns: Promise<void> = Promise.resolve()
let busy = false

const exclusive = (run: () => Promise<void>) =>
	(turns = turns.then(async () => {
		busy = true

		try {
			await run()
		} catch (err) {
			console.warn("[btr] watch check failed", err)
		} finally {
			busy = false
		}
	}))

const askPresence = async (ids: number[]) => {
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

const tick = async () => {
	const watched = listIds("watched")

	if (busy || !SETTINGS.get("profile.lastSeen")) {
		return
	}

	await exclusive(async () => {
		ownUserId ??= (await getJson("https://users.roblox.com/v1/users/authenticated"))?.id ?? null

		// You too, so your own playtime and recent servers are known.
		const presenceOf = [...new Set([...watched, ...(ownUserId ? [ownUserId] : [])])]

		if (presenceOf.length && Date.now() - lastPresence >= PRESENCE_EVERY) {
			lastPresence = Date.now()

			// Friends' presence comes live while the connection is up, so only
			// the rest are asked for. Without it, everyone is.
			const friends = new Set(
				(isLive() && ownUserId && (await getState<number[]>(`friends:${ownUserId}`))) || [],
			)
			const ids = presenceOf.filter((id) => !friends.has(id))

			if (ids.length) {
				await askPresence(ids)
			}
		}

		const due = (await getState<WatchChecks>("watchChecks")) ?? {}

		if (watched.length && Date.now() - lastQuick >= QUICK_EVERY) {
			lastQuick = Date.now()

			for (const userId of await quickCheck(watched)) {
				;(due[userId] ??= {}).profile = Date.now()
				await checkProfile(userId)
			}
		}

		for (const { userId, kind } of mostOverdue(
			watched,
			due,
			latestPresence,
			Date.now(),
			CHECKS_PER_TICK,
		)) {
			;(due[userId] ??= {})[kind] = Date.now()
			await CHECKS[kind](userId)
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
	})
}

const lastRefresh = new Map<number, number>()

/** Brings someone's checks up to date, for when their profile or activity is open. */
const refresh = async (userId: number) => {
	if (!SETTINGS.get("profile.lastSeen") || !listIds("watched").includes(userId)) {
		return
	}

	if (Date.now() - (lastRefresh.get(userId) ?? 0) < 3 * 60e3) {
		return
	}

	lastRefresh.set(userId, Date.now())

	await exclusive(async () => {
		await askPresence([userId])

		const due = (await getState<WatchChecks>("watchChecks")) ?? {}
		const checks = (due[userId] ??= {})

		for (const kind of CHECK_KINDS) {
			const older = kind === "favorites" ? REFRESH_FAVORITES_OLDER : REFRESH_OLDER

			if (Date.now() - (checks[kind] ?? 0) >= older) {
				checks[kind] = Date.now()
				await CHECKS[kind](userId)
			}
		}

		await setState("watchChecks", due)
	})
}

// Checks asked for by hand: each person or thing once a minute at most, and
// everything once every ten minutes, with a pause between checks so a long
// list is spread out rather than sent at once.
const FORCE_EACH = 60e3
const FORCE_ALL = 10 * 60e3
const FORCE_PAUSE = 1500
const lastForced = new Map<string, number>()
let forcingAll = false

export type ForceTarget = { kind: "user" | "game" | "group"; id: number } | { kind: "all" }

/** Where "check all" has got to, which the activity panel shows. */
const PROGRESS_KEY = "activityForceProgress"

const pause = () => delay(FORCE_PAUSE)

const saveProgress = (value: object) =>
	new Promise<void>((resolve) => chrome.storage.local.set({ [PROGRESS_KEY]: value }, () => resolve()))

/** Every check for one person, or just your followers for yourself. */
const forceUser = (userId: number) =>
	exclusive(async () => {
		await askPresence([userId])

		const due = (await getState<WatchChecks>("watchChecks")) ?? {}
		const checks = (due[userId] ??= {})
		const kinds = userId === ownUserId ? (["follows"] as const) : CHECK_KINDS

		for (const kind of kinds) {
			checks[kind] = Date.now()
			await CHECKS[kind](userId)
			await pause()
		}

		await setState("watchChecks", due)
	})

const forceAll = async () => {
	const targets: ForceTarget[] = [
		...listIds("watched").map((id) => ({ kind: "user" as const, id })),
		...listIds("game").map((id) => ({ kind: "game" as const, id })),
		...listIds("group").map((id) => ({ kind: "group" as const, id })),
	]

	forcingAll = true

	try {
		for (let i = 0; i < targets.length; i++) {
			await saveProgress({ done: i, total: targets.length, running: true })

			const target = targets[i] as { kind: "user" | "game" | "group"; id: number }
			lastForced.set(`${target.kind}:${target.id}`, Date.now())
			await (target.kind === "user" ? forceUser(target.id) : forceTrackedCheck(target.kind, target.id))
			await pause()
		}
	} finally {
		forcingAll = false
		await saveProgress({ done: targets.length, total: targets.length, running: false, at: Date.now() })
	}
}

/**
 * Runs checks now. One person or thing answers once it is checked; everything
 * answers as soon as it starts, and reports how far it has got in storage.
 */
const forceCheck = async (target: ForceTarget) => {
	if (!SETTINGS.get("profile.lastSeen")) {
		return { ok: false, reason: "off" }
	}

	const key = target.kind === "all" ? "all" : `${target.kind}:${target.id}`
	const wait = (target.kind === "all" ? FORCE_ALL : FORCE_EACH) - (Date.now() - (lastForced.get(key) ?? 0))

	if (wait > 0 || (target.kind === "all" && forcingAll)) {
		return { ok: false, wait: Math.max(wait, 0) }
	}

	lastForced.set(key, Date.now())

	if (target.kind === "all") {
		void forceAll()
		return { ok: true, started: true }
	}

	if (target.kind === "user") {
		ownUserId ??= (await getJson("https://users.roblox.com/v1/users/authenticated"))?.id ?? null

		if (!listIds("watched").includes(target.id) && target.id !== ownUserId) {
			return { ok: false, reason: "not watched" }
		}

		await forceUser(target.id)
		return { ok: true }
	}

	return { ok: await forceTrackedCheck(target.kind, target.id) }
}

export const startWatching = (): void => {
	setInterval(() => void tick(), 60e3)

	contentScript.listen("activityRefresh", (userId: number) => void refresh(userId))

	contentScript.listen(
		"activityForceCheck",
		async (target: ForceTarget, respond: (value: unknown) => void) => {
			respond(await forceCheck(target).catch(() => ({ ok: false })))
		},
	)

	/** When each of someone's checks last ran, for the dialogs to say. */
	contentScript.listen("activityChecks", async (userId: number, respond: (value: unknown) => void) => {
		const checks = (await getState<Record<number, Record<string, number>>>("watchChecks"))?.[userId] ?? {}
		const watched = listIds("watched").includes(userId)

		respond({ ...checks, ...(watched && lastPresence ? { presence: lastPresence } : {}) })
	})

	SETTINGS.load(() => {
		void tick()
		// Someone just added is looked at straight away.
		SETTINGS.onChange("profile.watchedUsers", () => void tick())
	})
}
