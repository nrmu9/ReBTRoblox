"use strict"

// Finds hooks that stopped matching after Roblox changed a page.
//
// Walks the bridge tab through a list of pages and reads the match counts the
// dev build keeps for every hook: element watchers in the content script, and
// react injects, constructor filters and angular modules in the page world. A
// hook that registers on some page but never matches on any of them is the
// usual sign of a renamed class or a page rebuilt in react.
//
//   node dev/health.js                  the default pages
//   node dev/health.js --wait=20 URL…   your own pages, 20s each
//   node dev/health.js --verbose        also list misses per page
//
// Needs the dev build in firefox with the bridge connected (npm run dev). It
// navigates the active roblox tab, so leave that tab alone while it runs. Some
// hooks only match after a click (popovers, menus) and are listed apart. Only
// a run over every page says much: page specific hooks register everywhere.

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
	"https://www.roblox.com/communities/7",
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
]

const expectedReason = (key) => EXPECTED.find(([part]) => key.includes(part))?.[1]

const args = process.argv.slice(2)
const verbose = args.includes("--verbose")
const wait = Number(args.find((arg) => arg.startsWith("--wait="))?.split("=")[1]) || 15
const pages = args.filter((arg) => !arg.startsWith("--"))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const evaluate = async (code, target = "tab") => {
	const res = await fetch(`${BRIDGE}/eval?target=${target}`, { method: "POST", body: code })
	const json = await res.json()

	if (!json.ok) {
		throw new Error(json.error || `bridge answered ${res.status}`)
	}

	return json.value
}

// Runs in the background page: points the active roblox tab somewhere else.
const navigate = (url) => `new Promise((resolve, reject) => {
	chrome.tabs.query({ url: "*://*.roblox.com/*", active: true }, (tabs) => {
		if (!tabs.length) return reject(new Error("no active roblox tab"))
		chrome.tabs.update(tabs[0].id, { url: ${JSON.stringify(url)} }, () => resolve("ok"))
	})
})`

// Runs in the content script, which reaches the page world's counts through
// wrappedJSObject. Copied out as JSON so nothing crosses as a live object.
const COLLECT = `JSON.stringify({
	url: location.href,
	content: globalThis.__btrHealth || null,
	page: window.wrappedJSObject?.__btrHealth || null,
	errors: window.wrappedJSObject?.__btrInjectErrors || [],
})`

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

	for (const url of list) {
		process.stdout.write(`${url} `)

		try {
			await evaluate(navigate(url), "bg")
			await sleep(wait * 1000)

			const report = JSON.parse(await evaluate(COLLECT))
			const page = new URL(report.url).pathname

			if (!report.content && !report.page) {
				throw new Error("no counts on the page: is this the dev build?")
			}

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

			console.log(`-> ${page}`)
		} catch (err) {
			console.log("failed")
			failed.push(`${url}: ${err.message}`)
		}
	}

	const never = [...seen].filter(([, entry]) => entry.matched.size === 0)
	never.sort(([a], [b]) => a.localeCompare(b))

	const missing = never.filter(([key]) => !expectedReason(key))
	const idle = never.filter(([key]) => expectedReason(key))

	console.log(`\n${seen.size} hooks seen, ${missing.length} never matched on any page:\n`)

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
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
