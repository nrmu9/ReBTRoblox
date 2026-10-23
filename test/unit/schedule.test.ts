import { test } from "node:test"
import assert from "node:assert/strict"
import { intervalsFor, mostOverdue, type WatchChecks } from "@/feat/activity/schedule"

const MINUTE = 60e3
const HOUR = 60 * MINUTE

test("someone playing is checked for badges most often, and offline least", () => {
	assert.equal(intervalsFor(2).badges, 10 * MINUTE)
	assert.equal(intervalsFor(1).badges, 30 * MINUTE)
	assert.equal(intervalsFor(0).badges, HOUR)
	assert.equal(intervalsFor(null).badges, HOUR)
})

test("being online makes every check but the profile sooner", () => {
	const offline = intervalsFor(0)
	const online = intervalsFor(1)

	for (const kind of ["friends", "badges", "favorites", "follows"] as const) {
		assert.ok(online[kind] < offline[kind], kind)
	}

	assert.equal(online.profile, offline.profile)
})

test("checks never run are the most overdue", () => {
	const now = 100 * HOUR
	const due: WatchChecks = {
		1: { friends: now, profile: now, badges: now, favorites: now, follows: now },
	}

	const picked = mostOverdue([1, 2], due, () => 0, now, 3)

	assert.equal(picked.length, 3)
	assert.ok(picked.every(({ userId }) => userId === 2))
})

test("nothing runs before its interval is up", () => {
	const now = 100 * HOUR
	const due: WatchChecks = {
		1: { friends: now - 59 * MINUTE, profile: now, badges: now, favorites: now, follows: now },
	}

	assert.deepEqual(
		mostOverdue([1], due, () => 0, now, 3),
		[],
	)
	assert.deepEqual(
		mostOverdue([1], due, () => 1, now, 3),
		[{ userId: 1, kind: "friends" }],
	)
})

test("the furthest behind goes first, by how many intervals it missed", () => {
	const now = 100 * HOUR
	const all = { friends: now, profile: now, badges: now, favorites: now, follows: now }
	const due: WatchChecks = {
		// Badges two intervals late while playing, against friends 1.5 late offline.
		1: { ...all, badges: now - 20 * MINUTE },
		2: { ...all, friends: now - 90 * MINUTE },
	}
	const presence = (userId: number) => (userId === 1 ? 2 : 0)

	assert.deepEqual(mostOverdue([1, 2], due, presence, now, 1), [{ userId: 1, kind: "badges" }])
	assert.deepEqual(mostOverdue([1, 2], due, presence, now, 5), [
		{ userId: 1, kind: "badges" },
		{ userId: 2, kind: "friends" },
	])
})
