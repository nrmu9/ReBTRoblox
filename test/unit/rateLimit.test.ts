import { test } from "node:test"
import assert from "node:assert/strict"
import { retryDelay } from "@/core/rateLimit"

const NOW = Date.UTC(2026, 9, 23, 12)

test("Retry-After in seconds is waited for exactly", () => {
	assert.equal(retryDelay("42", null, NOW, 0), 42000)
})

test("Retry-After as a date waits until then", () => {
	assert.equal(retryDelay(new Date(NOW + 90e3).toUTCString(), null, NOW, 0), 90000)
})

test("Roblox's own reset header is read when there is no Retry-After", () => {
	assert.equal(retryDelay(null, "15", NOW, 0), 15000)
	assert.equal(retryDelay("5", "15", NOW, 0), 5000, "Retry-After comes first")
})

test("a wait that says nothing grows with each 429 in a row", () => {
	assert.deepEqual(
		[0, 1, 2, 3, 9].map((inARow) => retryDelay(null, null, NOW, inARow)),
		[10e3, 30e3, 60e3, 120e3, 120e3],
	)
})

test("waits are kept between a second and five minutes", () => {
	assert.equal(retryDelay("0", null, NOW, 0), 1000)
	assert.equal(retryDelay("86400", null, NOW, 0), 5 * 60e3)
	assert.equal(retryDelay(new Date(NOW - 60e3).toUTCString(), null, NOW, 0), 1000, "a date already past")
})

test("a header that is not a number or a date falls back", () => {
	assert.equal(retryDelay("soon", "later", NOW, 1), 30e3)
})

test("a GET turned away waits as long as asked, asks once more, and holds the site meanwhile", async () => {
	const calls: number[] = []
	const answers = [
		new Response("", { status: 429, headers: { "retry-after": "1" } }),
		new Response("{}", { status: 200 }),
	]
	globalThis.fetch = (async () => {
		calls.push(Date.now())
		return answers.shift()!
	}) as typeof fetch

	const { installRateLimit, onRateLimits } = await import("@/core/rateLimit")
	installRateLimit()

	let held: Record<string, number> = {}
	onRateLimits((limits) => (held = limits))

	const res = await fetch("https://friends.roblox.com/v1/my/friends/count")

	assert.equal(res.status, 200)
	assert.equal(calls.length, 2)
	assert.ok(calls[1] - calls[0] >= 950, `asked again after ${calls[1] - calls[0]}ms`)
	assert.ok(held["friends.roblox.com"] > calls[0], "the site was held")
})
