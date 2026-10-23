import { test } from "node:test"
import assert from "node:assert/strict"
import {
	avatarHash,
	earnedSince,
	friendDiff,
	newAtTop,
	profileChanges,
	wearingDiff,
	type ProfileSnapshot,
} from "@/feat/activity/diff"

const AVATAR_A =
	"https://tr.rbxcdn.com/30DAY-Avatar-0123456789ABCDEF0123456789ABCDEF-Png/150/150/Avatar/Png/noFilter"
const AVATAR_B =
	"https://tr.rbxcdn.com/30DAY-Avatar-FEDCBA9876543210FEDCBA9876543210-Png/150/150/Avatar/Png/noFilter"

const profile = (over: Partial<ProfileSnapshot> = {}): ProfileSnapshot => ({
	name: "builder",
	displayName: "Builder",
	description: "",
	isBanned: false,
	avatar: AVATAR_A,
	groups: {},
	...over,
})

test("friends hidden from a list are not seen as added or removed", () => {
	assert.deepEqual(friendDiff([1, 2, -1, -1], [2, 3, -1]), { added: [3], removed: [1] })
	assert.deepEqual(friendDiff([1, 2], [-1, -1]), { added: [], removed: [1, 2] })
})

test("the same list twice changes nothing, whatever its order", () => {
	assert.deepEqual(friendDiff([1, 2, 3], [3, 1, 2]), { added: [], removed: [] })
})

test("new followers at the top of a long list stop at the newest one seen before", () => {
	assert.deepEqual(newAtTop([5, 4, 3], [9, 8, 5, 4]), [9, 8])
	assert.deepEqual(newAtTop([5, 4, 3], [5, 4, 3]), [])
})

test("a top with nobody seen before says nothing, as the gap could hide anyone", () => {
	assert.deepEqual(newAtTop([5, 4, 3], [9, 8, 7]), [])
	assert.deepEqual(newAtTop([], [9, 8]), [])
})

test("an avatar is told apart by its hash, not the rest of the address", () => {
	assert.equal(avatarHash(AVATAR_A), "0123456789ABCDEF0123456789ABCDEF")
	assert.equal(avatarHash(AVATAR_A.replace("150/150", "420/420")), avatarHash(AVATAR_A))
	assert.equal(avatarHash(null), null)
})

test("each changed field is one change", () => {
	const changes = profileChanges(
		profile(),
		profile({ displayName: "Maker", description: "hi", isBanned: true }),
	)

	assert.deepEqual(
		changes.map((change) => change.field),
		["displayName", "description", "isBanned"],
	)
	assert.deepEqual(changes[0], { field: "displayName", before: "Builder", after: "Maker" })
})

test("a failed avatar render is not an avatar change", () => {
	assert.deepEqual(profileChanges(profile(), profile({ avatar: null })), [])
	assert.deepEqual(profileChanges(profile({ avatar: null }), profile()), [])
})

test("an avatar change lists what was put on and taken off, by name", () => {
	const before = profile({ wearing: [10, 11] })
	const after = profile({ avatar: AVATAR_B, wearing: [11, 12] })

	assert.deepEqual(wearingDiff(before, after), { added: [12], removed: [10] })
	assert.deepEqual(profileChanges(before, after, new Map([[12, "Red Cap"]])), [
		{
			field: "avatar",
			before: AVATAR_A,
			after: AVATAR_B,
			items: {
				added: [{ id: 12, name: "Red Cap" }],
				removed: [{ id: 10, name: "Item 10" }],
			},
		},
	])
})

test("what was worn is only compared when the avatar changed and both looks know it", () => {
	assert.equal(wearingDiff(profile({ wearing: [1] }), profile({ wearing: [2] })), null)
	assert.equal(wearingDiff(profile(), profile({ avatar: AVATAR_B, wearing: [2] })), null)

	const [change] = profileChanges(profile(), profile({ avatar: AVATAR_B, wearing: [2] }))
	assert.equal(change.items, undefined)
})

test("communities joined, left and ranked up", () => {
	const before = profile({
		groups: {
			1: { name: "Builders", role: "Member", rank: 1 },
			2: { name: "Racers", role: "Member", rank: 1 },
		},
	})
	const after = profile({
		groups: {
			1: { name: "Builders", role: "Admin", rank: 200 },
			3: { name: "Pilots", role: "Member", rank: 1 },
		},
	})

	assert.deepEqual(profileChanges(before, after), [
		{
			field: "groupRole",
			before: { id: 1, name: "Builders", role: "Member", rank: 1 },
			after: { id: 1, name: "Builders", role: "Admin", rank: 200 },
		},
		{ field: "groupJoined", after: { id: 3, name: "Pilots" } },
		{ field: "groupLeft", before: { id: 2, name: "Racers" } },
	])
})

test("a role is not compared against an older snapshot that only kept names", () => {
	const before = profile({ groups: { 1: "Builders" } })
	const after = profile({ groups: { 1: { name: "Builders", role: "Admin", rank: 200 } } })

	assert.deepEqual(profileChanges(before, after), [])
})

test("a badge let back into the newest hundred is not new", () => {
	const badges = [{ id: 1 }, { id: 2 }, { id: 3 }]
	const awardedAt = new Map([
		[1, 5000],
		[2, 500],
	])

	// 3 was seen, 2 is older than the last look, so only 1 was earned since.
	assert.deepEqual(earnedSince(badges, [3], awardedAt, 1000), [{ id: 1 }])
})

test("a badge without an award date is not counted", () => {
	assert.deepEqual(earnedSince([{ id: 1 }], [], new Map(), 1000), [])
})
