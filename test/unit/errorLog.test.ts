import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanStack, errorReport, type ErrorEntry } from "@/feat/errorLog"

test("stacks lose the extension's id, which is unique to each install", () => {
	const stack = [
		"loadModel@moz-extension://e71a9dc8-84dc-4513-9b44-e291a3ae527e/js/chunk-ABC.js:3:57267",
		"at load (chrome-extension://dplimibgmlomamaljcclnjgcolbijcad/js/main.js:10:5)",
	].join("\n")
	const clean = cleanStack(stack)

	assert.ok(!clean.includes("e71a9dc8"))
	assert.ok(!clean.includes("dplimibgmlomamaljcclnjgcolbijcad"))
	assert.ok(clean.includes("ext/js/chunk-ABC.js:3:57267"))
	assert.ok(clean.includes("ext/js/main.js:10:5"))
})

test("very long stacks are cut short", () => {
	assert.ok(cleanStack("x".repeat(5000)).length <= 1501)
})

test("a report lists the newest first, with where, how often and the stack", () => {
	const log: ErrorEntry[] = [
		{
			at: Date.UTC(2026, 9, 23, 10),
			where: "content",
			page: "/home",
			message: "Error: old",
			count: 1,
			version: "4.5.0",
		},
		{
			at: Date.UTC(2026, 9, 23, 11),
			where: "background",
			message: "Error: new",
			stack: "ext/js/background.js:1:1",
			count: 3,
			version: "4.5.0",
		},
	]
	const report = errorReport(log)

	assert.ok(report.startsWith("ReBTRoblox "))
	assert.ok(report.indexOf("Error: new") < report.indexOf("Error: old"), "newest first")
	assert.ok(report.includes("[background] ×3"))
	assert.ok(report.includes("[content] /home"))
	assert.ok(report.includes("ext/js/background.js:1:1"))
})
