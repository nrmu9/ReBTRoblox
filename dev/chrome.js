"use strict"

// Runs the chrome build in chrome, which nothing else does: the unit tests run
// in node and day to day testing happens in firefox. Loads the release build,
// waits for its service worker, opens a few public roblox pages and fails on
// anything the extension's error log or the pages caught from it.
//
//   CHROME_PATH=/usr/bin/google-chrome node dev/chrome.js
//   node dev/chrome.js --install      fetches chrome for testing into a cache first
//
// Signed out, so only what runs for everyone is covered. Pages that cannot be
// reached are reported and skipped, as that is roblox or the network, not us.

const { fork } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const OUT = "artifacts/.chrome-test"
const CACHE = path.join(os.homedir(), ".cache", "rebtroblox-chrome")

const PAGES = ["https://www.roblox.com/home", "https://www.roblox.com/games/920587237"]
// Long enough for the content script, the page world hooks and their first
// requests to have run.
const SETTLE = 6000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const build = () =>
	new Promise((resolve, reject) => {
		const child = fork(path.join(__dirname, "build.js"), ["--target=chrome", `--out=${OUT}`], {
			stdio: "inherit",
		})
		child.on("exit", (code) => (code ? reject(new Error("chrome build failed")) : resolve()))
	})

const chromePath = async () => {
	if (process.env.CHROME_PATH) {
		return process.env.CHROME_PATH
	}

	if (!process.argv.includes("--install")) {
		throw new Error("Set CHROME_PATH to a chrome binary, or pass --install to fetch chrome for testing.")
	}

	const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import("@puppeteer/browsers")
	const platform = detectBrowserPlatform()
	const buildId = await resolveBuildId(Browser.CHROME, platform, "stable")
	const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE })

	return installed.executablePath
}

const main = async () => {
	const executablePath = await chromePath()
	await build()

	const { default: puppeteer } = await import("puppeteer-core")
	const browser = await puppeteer.launch({
		executablePath,
		headless: true,
		pipe: true,
		enableExtensions: [path.join(ROOT, OUT)],
		// Ubuntu runners stop chrome's sandbox from starting.
		args: process.env.CI ? ["--no-sandbox"] : [],
	})

	const problems = []
	const skipped = []

	try {
		const target = await browser.waitForTarget(
			(t) => t.type() === "service_worker" && t.url().endsWith("/js/background.js"),
			{ timeout: 15000 },
		)
		const worker = await target.worker()
		const version = await worker.evaluate(() => chrome.runtime.getManifest().version)
		console.log(`service worker up, version ${version}`)

		for (const url of PAGES) {
			const page = await browser.newPage()

			// The page world script reports its own failures as page errors.
			page.on("pageerror", (err) => {
				if (String(err?.stack ?? err).includes("chrome-extension://")) {
					problems.push(`${url}: ${String(err?.message ?? err)}`)
				}
			})

			try {
				await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
			} catch (err) {
				skipped.push(`${url}: ${err.message}`)
				await page.close()
				continue
			}

			await sleep(SETTLE)

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

		const log = await worker.evaluate(() =>
			chrome.storage.local.get("errorLog").then((data) => data.errorLog ?? []),
		)

		for (const entry of log) {
			problems.push(`[${entry.where}] ${entry.message}${entry.count > 1 ? ` (x${entry.count})` : ""}`)
		}
	} finally {
		await browser.close()
	}

	for (const line of skipped) {
		console.log(`skipped ${line}`)
	}

	if (problems.length) {
		console.error(`\n${problems.length} problem(s) in chrome:\n`)

		for (const line of problems) {
			console.error(`  ${line}`)
		}

		process.exitCode = 1
	} else {
		console.log("\nno errors in chrome")
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
