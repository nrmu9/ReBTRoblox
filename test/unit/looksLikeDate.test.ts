import { test } from "node:test"
import assert from "node:assert/strict"
import { looksLikeDate } from "@/core/date"

test("Dates in any language's format read as dates", () => {
	for (const text of [
		"7/14/2017",
		"14.07.2017",
		"2017/7/14",
		"2017. 7. 14.",
		"14/07/2017",
		"2017年7月14日",
	]) {
		assert.equal(looksLikeDate(text), true, text)
	}
})

test("Counts and other stats do not", () => {
	for (const text of [
		"29,900,013",
		"245.298",
		"45.4B+",
		"35",
		"Not Supported",
		"2 hours ago",
		"1,234,567",
		"",
	]) {
		assert.equal(looksLikeDate(text), false, text)
	}
})
