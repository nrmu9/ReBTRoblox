import { test } from "node:test"
import assert from "node:assert/strict"
import { isId, isKey, isRecord, isRobloxUrl, isText } from "@/core/pageInput"

test("ids are whole numbers above zero", () => {
	assert.ok(isId(1))
	assert.ok(isId(9007199254740991))
	assert.ok(!isId(0))
	assert.ok(!isId(-5))
	assert.ok(!isId(1.5))
	assert.ok(!isId("12"))
	assert.ok(!isId(Number.NaN))
})

test("keys refuse names that reach a prototype", () => {
	assert.ok(isKey("hero-unit"))
	assert.ok(!isKey("__proto__"))
	assert.ok(!isKey("constructor"))
	assert.ok(!isKey("prototype"))
	assert.ok(!isKey(""))
	assert.ok(!isKey("x".repeat(201)))
	assert.ok(!isKey(5))
})

test("text is a string within its length", () => {
	assert.ok(isText(""))
	assert.ok(isText("a".repeat(500)))
	assert.ok(!isText("a".repeat(501)))
	assert.ok(!isText(null))
})

test("roblox urls are https on roblox.com only", () => {
	assert.ok(isRobloxUrl("https://www.roblox.com/home"))
	assert.ok(isRobloxUrl("https://presence.roblox.com/v1/presence/users"))
	assert.ok(isRobloxUrl("https://roblox.com/"))
	assert.ok(!isRobloxUrl("http://www.roblox.com/"))
	assert.ok(!isRobloxUrl("https://roblox.com.evil.example/"))
	assert.ok(!isRobloxUrl("https://evilroblox.com/"))
	assert.ok(!isRobloxUrl("javascript:alert(1)"))
	assert.ok(!isRobloxUrl("not a url"))
	assert.ok(!isRobloxUrl(42))
})

test("records are plain objects, not arrays or null", () => {
	assert.ok(isRecord({}))
	assert.ok(!isRecord([]))
	assert.ok(!isRecord(null))
	assert.ok(!isRecord("x"))
})
