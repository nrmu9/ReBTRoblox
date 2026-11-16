import { test } from "node:test"
import assert from "node:assert/strict"
import { applyRowOrder, parseRowOrder } from "@/feat/homeOrder"

const ids = (rows: string[], order: string[]) => applyRowOrder(rows, (x) => x, order)

test("Home rows follow the saved order", () => {
	assert.deepEqual(ids(["a", "b", "c", "d"], ["d", "c", "b", "a"]), ["d", "c", "b", "a"])
	assert.deepEqual(ids(["a", "b", "c"], []), ["a", "b", "c"])
})

test("A row with no place in the order stays where Roblox put it", () => {
	assert.deepEqual(ids(["a", "new", "b", "c"], ["c", "a", "b"]), ["c", "new", "a", "b"])
})

test("Rows that are gone from Home are skipped", () => {
	assert.deepEqual(ids(["b", "a"], ["gone", "a", "b"]), ["a", "b"])
})

test("A broken saved order reads as none", () => {
	assert.deepEqual(parseRowOrder(""), [])
	assert.deepEqual(parseRowOrder("{"), [])
	assert.deepEqual(parseRowOrder('{"a":1}'), [])
	assert.deepEqual(parseRowOrder('["1", 2]'), ["1", "2"])
})
