import type { ActivityEvent } from "@/feat/activity/store"

// What changed between two looks at someone, kept apart from the fetching and
// storing so it can be tested.

export interface GroupEntry {
	name: string
	role: string
	rank: number
}

export interface ProfileSnapshot {
	name: string
	displayName: string
	description: string
	isBanned: boolean
	/** The avatar image's address, whose hash changes with the avatar. */
	avatar: string | null
	/** Older snapshots kept only the name. */
	groups: Record<string, GroupEntry | string>
	/** Asset ids worn, read when the avatar changes. */
	wearing?: number[]
}

export type ProfileChange = Pick<ActivityEvent, "field" | "before" | "after" | "items">

/** What is in `now` and not in `was`, and the other way round. */
export const listDiff = (was: number[], now: number[]) => {
	const wasSet = new Set(was)
	const nowSet = new Set(now)

	return {
		added: now.filter((id) => !wasSet.has(id)),
		removed: was.filter((id) => !nowSet.has(id)),
	}
}

/** Friends added and removed. Friends someone hides from their list come as -1. */
export const friendDiff = (was: number[], now: number[]) =>
	listDiff(
		was.filter((id) => id > 0),
		now.filter((id) => id > 0),
	)

/**
 * New followers when only the top of a long list is read: whoever is above the
 * newest follower seen last time. With none of them in sight nothing is known.
 */
export const newAtTop = (recent: number[], top: number[]): number[] => {
	const known = new Set(recent)
	const firstKnown = top.findIndex((id) => known.has(id))
	return top.slice(0, firstKnown === -1 ? 0 : firstKnown)
}

/** The part of an avatar image's address that changes with the avatar. */
export const avatarHash = (url: string | null) => url?.match(/-([0-9A-F]{32})-/i)?.[1] ?? url

const groupName = (entry: GroupEntry | string) => (typeof entry === "string" ? entry : entry.name)

/** Items put on and taken off, when both looks know what was worn and the avatar changed. */
export const wearingDiff = (before: ProfileSnapshot, after: ProfileSnapshot) =>
	before.avatar &&
	after.avatar &&
	avatarHash(before.avatar) !== avatarHash(after.avatar) &&
	before.wearing &&
	after.wearing
		? listDiff(before.wearing, after.wearing)
		: null

/** One change per field that differs, with worn items named from `itemNames`. */
export const profileChanges = (
	before: ProfileSnapshot,
	after: ProfileSnapshot,
	itemNames: Map<number, string> = new Map(),
): ProfileChange[] => {
	const changes: ProfileChange[] = []

	for (const field of ["name", "displayName", "description", "isBanned"] as const) {
		if (before[field] !== after[field]) {
			changes.push({ field, before: before[field], after: after[field] })
		}
	}

	// A render that failed says nothing about the avatar.
	if (before.avatar && after.avatar && avatarHash(before.avatar) !== avatarHash(after.avatar)) {
		const change: ProfileChange = { field: "avatar", before: before.avatar, after: after.avatar }
		const worn = wearingDiff(before, after)

		if (worn) {
			const named = (ids: number[]) =>
				ids.map((id) => ({ id, name: itemNames.get(id) ?? `Item ${id}` }))
			change.items = { added: named(worn.added), removed: named(worn.removed) }
		}

		changes.push(change)
	}

	for (const [id, entry] of Object.entries(after.groups)) {
		const old = before.groups[id]

		if (!old) {
			changes.push({ field: "groupJoined", after: { id: Number(id), name: groupName(entry) } })
		} else if (typeof old !== "string" && typeof entry !== "string" && old.rank !== entry.rank) {
			// A role from an older snapshot that kept only names is not known.
			changes.push({
				field: "groupRole",
				before: { id: Number(id), ...old },
				after: { id: Number(id), ...entry },
			})
		}
	}

	for (const [id, entry] of Object.entries(before.groups)) {
		if (!(id in after.groups)) {
			changes.push({ field: "groupLeft", before: { id: Number(id), name: groupName(entry) } })
		}
	}

	return changes
}

/** Badges new since the last look and awarded after it, so one let back into the newest hundred is not new. */
export const earnedSince = <T extends { id: number }>(
	badges: T[],
	known: number[],
	awardedAt: Map<number, number>,
	checkedAt: number,
): T[] => {
	const seen = new Set(known)
	return badges.filter((badge) => !seen.has(badge.id) && (awardedAt.get(badge.id) ?? 0) > checkedAt)
}
