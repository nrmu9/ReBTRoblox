import { test } from "node:test"
import assert from "node:assert/strict"
import { linkKey, mergeOrder } from "@/feat/navOrder"

test("links lose ids, queries and the www host", () => {
	assert.equal(linkKey("https://www.roblox.com/users/12345/profile"), "/users/profile")
	assert.equal(linkKey("/users/friends#!/friend-requests"), "/users/friends")
	assert.equal(linkKey("https://www.roblox.com/upgrades/robux?ctx=navpopover"), "/upgrades/robux")
	assert.equal(linkKey("https://create.roblox.com/"), "create.roblox.com/")
})

test("any featured game is the same slot", () => {
	assert.equal(linkKey("https://www.roblox.com/games/116463962153167/The-Hollow"), "/games")
	assert.equal(linkKey("/games/1818/Classic-Crossroads"), "/games")
})

test("the plus referral banner is told apart from plus itself", () => {
	assert.equal(linkKey("https://www.roblox.com/plus?referrals"), "/plus?referrals")
	assert.equal(linkKey("https://www.roblox.com/plus"), "/plus")
})

test("a saved order is kept, dropping what is gone", () => {
	assert.deepEqual(mergeOrder(["c", "a", "gone", "b"], ["a", "b", "c"]), ["c", "a", "b"])
})

test("something new goes after what it follows on the page", () => {
	// "new" comes after "a" on the page, so it stays after "a" in the saved order.
	assert.deepEqual(mergeOrder(["c", "a", "b"], ["a", "new", "b", "c"]), ["c", "a", "new", "b"])
})

test("something new at the very start stays first", () => {
	assert.deepEqual(mergeOrder(["b", "a"], ["first", "a", "b"]), ["first", "b", "a"])
})

test("with nothing saved, the page order stands", () => {
	assert.deepEqual(mergeOrder([], ["a", "b", "c"]), ["a", "b", "c"])
})
