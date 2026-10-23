// When each check on a watched person is due, kept apart from the checks so
// it can be tested.

export type CheckKind = "friends" | "profile" | "badges" | "favorites" | "follows"

export const CHECK_KINDS: CheckKind[] = ["friends", "profile", "badges", "favorites", "follows"]

export type WatchChecks = Record<number, Partial<Record<CheckKind, number>>>

/**
 * How often each check runs, by Roblox's presence type (0 offline, 1 online,
 * 2 in game). Someone online is checked sooner: friends are added and badges
 * earned while they play, and little changes while they are away.
 */
export const intervalsFor = (presence: number | null | undefined): Record<CheckKind, number> => {
	const online = !!presence
	const playing = presence === 2

	return {
		friends: (online ? 20 : 60) * 60e3,
		profile: 4 * 60 * 60e3,
		badges: (playing ? 10 : online ? 30 : 60) * 60e3,
		favorites: (online ? 2 : 4) * 60 * 60e3,
		follows: (online ? 1 : 2) * 60 * 60e3,
	}
}

/** The `limit` checks most overdue, by how many of their intervals have passed. */
export const mostOverdue = (
	userIds: number[],
	due: WatchChecks,
	presenceOf: (userId: number) => number | null | undefined,
	now: number,
	limit: number,
): Array<{ userId: number; kind: CheckKind }> => {
	const overdue: Array<{ userId: number; kind: CheckKind; by: number }> = []

	for (const userId of userIds) {
		const intervals = intervalsFor(presenceOf(userId))

		for (const kind of CHECK_KINDS) {
			const by = (now - (due[userId]?.[kind] ?? 0)) / intervals[kind]

			if (by >= 1) {
				overdue.push({ userId, kind, by })
			}
		}
	}

	return overdue
		.toSorted((a, b) => b.by - a.by)
		.slice(0, limit)
		.map(({ userId, kind }) => ({ userId, kind }))
}
