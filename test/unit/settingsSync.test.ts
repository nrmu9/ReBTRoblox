import { test } from "node:test"
import assert from "node:assert/strict"
import { fromChunks, mergeSynced, takesSynced, toChunks } from "@/feat/settingsSync"

test("settings are cut into pieces that fit and put back unchanged", () => {
	const text = JSON.stringify({ a: "x".repeat(20000), b: [1, 2, 3] })
	const pieces = toChunks(text)

	assert.ok(pieces.every((piece) => piece.length <= 7000))
	assert.equal(pieces.length, Math.ceil(text.length / 7000))

	const stored = Object.fromEntries(pieces.map((piece, i) => [`btrSync:${i}`, piece]))
	assert.equal(fromChunks(stored, pieces.length), text)
})

test("empty settings still make one piece", () => {
	assert.deepEqual(toChunks("{}"), ["{}"])
})

test("a missing piece reads as nothing rather than as half the settings", () => {
	assert.equal(fromChunks({ "btrSync:0": '{"a":' }, 2), null)
})

test("a device takes what is synced on its first sync, whatever it saved", () => {
	assert.ok(takesSynced({ format: 3, savedAt: 2000 }, { format: 3, savedAt: 1000 }, false))
	assert.ok(takesSynced(null, { format: 3, savedAt: 1000 }, true))
})

test("after that the newest save wins", () => {
	assert.ok(takesSynced({ format: 3, savedAt: 1000 }, { format: 3, savedAt: 2000 }, true))
	assert.ok(!takesSynced({ format: 3, savedAt: 2000 }, { format: 3, savedAt: 1000 }, true))
	assert.ok(!takesSynced({ format: 3, savedAt: 1000 }, { format: 3, savedAt: 1000 }, true))
})

test("settings in another format are never taken", () => {
	assert.ok(!takesSynced({ format: 3, savedAt: 1000 }, { format: 4, savedAt: 2000 }, false))
})

test("the sync switch stays this device's own", () => {
	const synced = { "general.theme": { v: "dark" }, "general.syncSettings": { v: false } }

	assert.deepEqual(mergeSynced(synced, undefined), { "general.theme": { v: "dark" } })
	assert.deepEqual(mergeSynced(synced, { "general.syncSettings": { v: true } }), {
		"general.theme": { v: "dark" },
		"general.syncSettings": { v: true },
	})
})
