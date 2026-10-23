"use strict"

// Finds hooks that stopped matching after Roblox changed a page.
//
// Opens its own browser window and walks it through a list of pages, reading
// the match counts the dev build keeps for every hook: element watchers and
// lookups inside them in the content script, and react injects, constructor
// filters and angular modules in the page world. A hook that registers on
// some page but never matches on any of them is the usual sign of a renamed
// class or a page rebuilt in react.
//
//   node dev/health.js                  the default pages
//   node dev/health.js URL…             your own pages
//   node dev/health.js --tabs=1         one page at a time (default 3)
//   node dev/health.js --wait=20        give a slow page up to 20s (default 15)
//   node dev/health.js --verbose        also list misses per page
//
// Needs the dev build in firefox with the bridge connected (npm run dev).
// Your own tabs are left alone. Each page is read once its counts stop
// changing, so most take a few seconds rather than the full wait. Some hooks
// only match after a click (popovers, menus) and are listed apart. Only a run
// over every page says much: page specific hooks register everywhere.

const BRIDGE = `http://127.0.0.1:${Number(process.env.BTR_BRIDGE_PORT) || 8787}`

const PAGES = [
	"https://www.roblox.com/home",
	"https://www.roblox.com/users/profile",
	"https://www.roblox.com/games/920587237",
	"https://www.roblox.com/charts",
	"https://www.roblox.com/catalog",
	"https://www.roblox.com/catalog/1365767",
	"https://www.roblox.com/my/avatar",
	"https://www.roblox.com/users/inventory",
	"https://www.roblox.com/users/friends",
	"https://www.roblox.com/my/messages",
	// Roblox's own groups get new layouts first, so an ordinary one is checked.
	"https://www.roblox.com/communities/295182",
	"https://www.roblox.com/transactions",
	"https://create.roblox.com/dashboard/creations",
]

// Hooks that only match after a click or on some accounts, matched by part of
// their key. They are listed apart so the real misses stand out.
const EXPECTED = [
	["#buy-robux-popover", "after opening the robux menu"],
	[".foundation-web-menu:has(", "while the account menu is open"],
	["#configure-item", "on items you own"],
	["VisitButtonEditGLI", "on games you can edit"],
	[".btr-wrapper-Store", "on profiles with a store"],
	[".btr-wrapper-Collections", "on profiles with collections"],
	["gameUrl", "for a friend who is in a game"],
	[".MuiMenu-list > li", "while a community's menu is open"],
	["profile header sent by the page", "with exact counts on, on a profile"],
]

const expectedReason = (key) => EXPECTED.find(([part]) => key.includes(part))?.[1]

const args = process.argv.slice(2)
const option = (name, fallback) =>
	Number(args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1]) || fallback
const verbose = args.includes("--verbose")
const wait = option("wait", 15)
const tabs = option("tabs", 3)
const pages = args.filter((arg) => !arg.startsWith("--"))

// A page counts as loaded once its counts hold still this long.
const SETTLE = 3000
const POLL = 750

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const evaluate = async (code) => {
	const res = await fetch(`${BRIDGE}/eval?target=bg`, { method: "POST", body: code })
	const json = await res.json()

	if (!json.ok) {
		throw new Error(json.error || `bridge answered ${res.status}`)
	}

	return json.value
}

// Unfocused, so it does not take over the screen. The window stays visible
// behind yours, which keeps its pages rendering as if they were in front.
const openWindow = () =>
	evaluate(`browser.windows
		.create({ url: "about:blank", focused: false, width: 1280, height: 900 })
		.then((win) => ({ windowId: win.id, tabId: win.tabs[0].id }))`)

const closeWindow = (windowId) => evaluate(`browser.windows.remove(${windowId}).then(() => "ok")`)

const navigate = (tabId, url) =>
	evaluate(`browser.tabs.update(${tabId}, { url: ${JSON.stringify(url)} }).then(() => "ok")`)

// Runs in the tab's content script, which reaches the page world's counts
// through wrappedJSObject. Copied out as JSON so nothing crosses as a live
// object. A page read before is marked, so its counts are not read twice.
const COLLECT = `(() => {
	if (document.readyState !== "complete" || globalThis.__btrHealthRead) return null
	return JSON.stringify({
		url: location.href,
		content: globalThis.__btrHealth || null,
		page: window.wrappedJSObject?.__btrHealth || null,
		errors: window.wrappedJSObject?.__btrInjectErrors || [],
	})
})()`

const collect = (tabId, mark) =>
	evaluate(
		`browser.tabs.executeScript(${tabId}, { code: ${JSON.stringify(mark ? "globalThis.__btrHealthRead = true" : COLLECT)} })
			.then((results) => results[0])
			.catch(() => null)`,
	)

/** Loads `url` and returns its counts once they stop changing, or at the wait limit. */
const check = async (tabId, url) => {
	await navigate(tabId, url)

	const started = Date.now()
	let last = null
	let stableSince = 0
	let report = null

	while (Date.now() - started < wait * 1000) {
		await sleep(POLL)

		const text = await collect(tabId)

		if (!text) {
			continue
		}

		report = JSON.parse(text)
		const counts = JSON.stringify([report.content, report.page])

		if (counts !== last) {
			last = counts
			stableSince = Date.now()
		} else if (Date.now() - stableSince >= SETTLE) {
			break
		}
	}

	await collect(tabId, true)

	if (!report) {
		throw new Error("the page did not finish loading")
	}

	if (!report.content && !report.page) {
		throw new Error("no counts on the page: is this the dev build?")
	}

	return { ...report, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

const main = async () => {
	const status = await fetch(`${BRIDGE}/status`)
		.then((res) => res.json())
		.catch(() => null)

	if (!status?.connected) {
		console.error(`The bridge at ${BRIDGE} is not connected. Start npm run dev and open a roblox tab.`)
		process.exit(1)
	}

	const list = pages.length ? pages : PAGES
	const seen = new Map() // key -> { registered: Set<page>, matched: Set<page> }
	const failed = []
	const errors = new Set()
	const queue = [...list]
	const windows = []
	const started = Date.now()

	const cleanUp = () => Promise.all(windows.map((win) => closeWindow(win.windowId).catch(() => {})))

	process.on("SIGINT", () => cleanUp().then(() => process.exit(130)))

	// Each worker has a window of its own, as a tab behind another in the same
	// window stops drawing and would miss whatever only appears on screen.
	const worker = async () => {
		const win = await openWindow()
		windows.push(win)

		for (let url = queue.shift(); url; url = queue.shift()) {
			try {
				const report = await check(win.tabId, url)
				const page = new URL(report.url).pathname

				for (const counts of [report.content, report.page]) {
					for (const [key, hits] of Object.entries(counts || {})) {
						const entry = seen.get(key) ?? { registered: new Set(), matched: new Set() }
						entry.registered.add(page)

						if (hits > 0) {
							entry.matched.add(page)
						}

						seen.set(key, entry)
					}
				}

				for (const error of report.errors) {
					errors.add(error.split("\n")[0])
				}

				console.log(`${url} -> ${page} (${report.seconds}s)`)
			} catch (err) {
				console.log(`${url} failed`)
				failed.push(`${url}: ${err.message}`)
			}
		}
	}

	try {
		await Promise.all(Array.from({ length: Math.min(tabs, list.length) }, worker))
	} finally {
		await cleanUp()
	}

	const never = [...seen].filter(([, entry]) => entry.matched.size === 0)
	never.sort(([a], [b]) => a.localeCompare(b))

	const missing = never.filter(([key]) => !expectedReason(key))
	const idle = never.filter(([key]) => expectedReason(key))

	console.log(
		`\n${list.length} pages in ${Math.round((Date.now() - started) / 1000)}s. ` +
			`${seen.size} hooks seen, ${missing.length} never matched on any page:\n`,
	)

	for (const [key, entry] of missing) {
		console.log(`  ${key}`)
		console.log(`      registered on ${entry.registered.size} page(s)`)
	}

	if (idle.length) {
		console.log("\nAlso unmatched, but they only match:\n")

		for (const [key] of idle) {
			console.log(`  ${key}\n      ${expectedReason(key)}`)
		}
	}

	if (verbose) {
		console.log("\nMatched somewhere, missed on a page it registered on:\n")

		for (const [key, entry] of seen) {
			const missed = [...entry.registered].filter((page) => !entry.matched.has(page))

			if (entry.matched.size && missed.length) {
				console.log(`  ${key}\n      missed on ${missed.join(", ")}`)
			}
		}
	}

	if (errors.size) {
		console.log("\nInjected functions that threw:\n")

		for (const error of errors) {
			console.log(`  ${error}`)
		}
	}

	if (failed.length) {
		console.log("\nPages that could not be checked:\n")

		for (const line of failed) {
			console.log(`  ${line}`)
		}
	}

	process.exitCode = missing.length || failed.length ? 1 : 0
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
