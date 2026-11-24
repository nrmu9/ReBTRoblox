"use strict"

// Runs the firefox build in firefox, signed out, the way dev/chrome.js does for
// chrome. Firefox runs content scripts behind Xray wrappers, so code that works
// in node and chrome can still throw there (spreading a page object's
// iterator, using a page owned ArrayBuffer), and only a real firefox shows it.
//
// Installs the build as a temporary add-on, opens a few public roblox pages,
// and fails on errors from the extension: the pages' own uncaught errors, and
// the extension's error log, read from the settings panel.
//
//   FIREFOX_PATH=/usr/bin/firefox node dev/firefox.js
//   node dev/firefox.js --install      fetches the latest stable firefox into a cache first
//
// Pages that cannot be reached are reported and skipped, as that is roblox or
// the network, not us.

const { fork } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const OUT = "artifacts/.firefox-test-ci"
const CACHE = path.join(os.homedir(), ".cache", "rebtroblox-firefox-ci")

const PAGES = ["https://www.roblox.com/home", "https://www.roblox.com/games/920587237"]
// Long enough for the content script, the page world hooks and their first
// requests to have run.
const SETTLE = 8000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const build = () =>
	new Promise((resolve, reject) => {
		const child = fork(path.join(__dirname, "build.js"), ["--target=firefox", `--out=${OUT}`], {
			stdio: "inherit",
		})
		child.on("exit", (code) => (code ? reject(new Error("firefox build failed")) : resolve()))
	})

const firefoxPath = async () => {
	if (process.env.FIREFOX_PATH) {
		return process.env.FIREFOX_PATH
	}

	if (!process.argv.includes("--install")) {
		throw new Error("Set FIREFOX_PATH to a firefox binary, or pass --install to fetch firefox.")
	}

	const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import("@puppeteer/browsers")
	const platform = detectBrowserPlatform()
	const buildId = await resolveBuildId(Browser.FIREFOX, platform, "stable")
	const installed = await install({ browser: Browser.FIREFOX, buildId, cacheDir: CACHE })

	return installed.executablePath
}

const main = async () => {
	const executablePath = await firefoxPath()

	await build()

	const { default: puppeteer } = await import("puppeteer-core")
	// Its own instance, even when a firefox of the same install is already open.
	const browser = await puppeteer.launch({
		browser: "firefox",
		executablePath,
		headless: true,
		args: ["--no-remote"],
	})

	const problems = []
	const skipped = []

	try {
		await browser.installExtension(path.join(ROOT, OUT))

		// Opens a page and lets it settle. Roblox pages often never fire load
		// under webdriver bidi, so it waits for the navigation to start instead.
		const visit = async (url) => {
			const page = await browser.newPage()

			page.on("pageerror", (err) => {
				if (String(err?.stack ?? err).includes("moz-extension://")) {
					problems.push(`${url}: ${String(err?.message ?? err)}`)
				}
			})

			try {
				await page.goto(url, { waitUntil: "commit", timeout: 30000 })
			} catch (err) {
				skipped.push(`${url}: ${err.message}`)
				await page.close()
				return null
			}

			await sleep(SETTLE)
			return page
		}

		for (const url of PAGES) {
			const page = await visit(url)
			if (!page) {
				continue
			}

			// The content script marks the page, and the main bundle adds the
			// stylesheet its element watchers run on.
			const state = await page.evaluate(() => ({
				marked: document.documentElement.getAttribute("btr-loaded") === "true",
				bundle: !!document.querySelector("style[data-btr-hook]"),
				path: location.pathname,
			}))

			if (!state.marked || !state.bundle) {
				problems.push(
					`${url}: content script ${state.marked ? "ran" : "did not run"}, main bundle ${state.bundle ? "ran" : "did not run"}`,
				)
			}

			console.log(`${url} -> ${state.path}`)
			await page.close()
		}

		// The error log lives in the background, which this cannot reach in
		// firefox, so it is read where the settings panel shows it: Recent Errors
		// on the Experiments page. The panel reopens on the page it was left on.
		// Home sends signed out visitors to the login page, so a game page it is.
		const page = await visit(PAGES[1])
		if (page) {
			await page.evaluate(() => sessionStorage.setItem("btr-settings-open", "advanced"))
			await page.reload({ waitUntil: "commit" })
			await sleep(SETTLE)

			const log = await page.evaluate(() => {
				const summary = document.querySelector(".btr-error-log-summary")?.textContent ?? null
				const entries = [...document.querySelectorAll(".btr-error-log-list > li")].map((li) =>
					li.textContent.replace(/\s+/g, " ").trim(),
				)
				return { summary, entries }
			})

			if (log.summary === null) {
				problems.push("the settings panel did not open, so the error log could not be read")
			} else if (log.summary !== "No errors") {
				problems.push(`error log: ${log.summary}`, ...log.entries.map((entry) => `  ${entry}`))
			}

			await page.close()
		}
	} finally {
		await browser.close()
	}

	for (const line of skipped) {
		console.log(`skipped ${line}`)
	}

	if (problems.length) {
		console.error(`\n${problems.length} problem(s) in firefox:\n`)

		for (const line of problems) {
			console.error(`  ${line}`)
		}

		process.exitCode = 1
	} else {
		console.log("\nno errors in firefox")
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
