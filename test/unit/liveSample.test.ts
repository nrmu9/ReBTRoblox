import { test } from "node:test"
import assert from "node:assert/strict"
import { createSettler, rampValue } from "@/feat/liveSample"

const A = 172752
const B = 173151

test("two caches answering in turn do not make the count bounce", () => {
	// Players on a busy game, sampled every 3 seconds.
	const samples = [A, B, B, A, A, B, A, A, A, A, A, A, B, B, A, A, B, B]
	const settle = createSettler()
	const shown = samples.map((value, i) => settle(value, i * 3000))
	const changes = shown.filter((value, i) => i && value !== shown[i - 1]).length

	assert.ok(changes <= 2, `changed ${changes} times`)
})

test("a new count is shown at once", () => {
	const settle = createSettler()

	assert.equal(settle(100, 0), 100)
	assert.equal(settle(105, 3000), 105)
	assert.equal(settle(103, 6000), 103)
})

test("a value seen a minute ago or more is new again", () => {
	const settle = createSettler()

	settle(100, 0)
	settle(105, 3000)
	assert.equal(settle(100, 6000), 105, "seen a moment ago, so a stale cache")
	assert.equal(settle(105, 9000), 105)
	assert.equal(settle(100, 70000), 100)
})

test("a count going back is believed once the samples agree on it", () => {
	const settle = createSettler()

	settle(100, 0)
	settle(105, 3000)
	assert.equal(settle(100, 6000), 105)
	assert.equal(settle(100, 9000), 105)
	assert.equal(settle(100, 12000), 105)
	assert.equal(settle(100, 15000), 100, "four in a row")
})

test("a count moves in whole steps and lands exactly", () => {
	assert.equal(rampValue(100, 200, 0, 1000), 100)
	assert.equal(rampValue(100, 200, 500, 1000), 150)
	assert.equal(rampValue(100, 200, 999, 1000), 200)
	assert.equal(rampValue(100, 200, 5000, 1000), 200)
	assert.equal(rampValue(200, 100, 250, 1000), 175)
	assert.ok(Number.isInteger(rampValue(0, 7, 333, 1000)))
})
