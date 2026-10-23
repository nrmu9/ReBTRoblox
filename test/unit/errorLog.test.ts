import { test } from "node:test"
import assert from "node:assert/strict"
import { browserName, bugReportUrl, cleanStack, errorReport, type ErrorEntry } from "@/feat/errorLog"

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

test("a bug report names the browser and its major version", () => {
	assert.equal(
		browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0"),
		"Firefox 150",
	)
	assert.equal(
		browserName(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
		),
		"Edge 147",
	)
	assert.equal(
		browserName(
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
		),
		"Chrome 147",
	)
	assert.equal(browserName("curl/8.0"), "")
})

test("the bug report link fills in the version and browser, and nothing from the log", () => {
	const url = new URL(bugReportUrl("4.5.0", "Gecko/20100101 Firefox/150.0"))

	assert.equal(url.origin + url.pathname, "https://github.com/nrmu9/ReBTRoblox/issues/new")
	assert.equal(url.searchParams.get("template"), "bug_report.yml")
	assert.equal(url.searchParams.get("version"), "4.5.0")
	assert.equal(url.searchParams.get("browser"), "Firefox 150")
	assert.deepEqual([...url.searchParams.keys()].toSorted(), ["browser", "template", "version"])
})
