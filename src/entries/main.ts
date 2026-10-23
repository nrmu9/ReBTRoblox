// Real content bundle. Loaded by entries/content.ts, which owns the
// document_start guard so this can be code split without losing timing.

// Content script entry.
//
// Import order matters: the $ extensions install first, then the feature
// modules register themselves on import. Each page's own module is loaded only
// on that page, and registers itself into pageInit when it arrives.

import { installExtensions } from "@/core/extend"
import { installRateLimit } from "@/core/rateLimit"
import { startErrorLog } from "@/feat/errorLog"
import { IS_CHROME, IS_DEV_MODE } from "@/core/env"
import { html } from "@/core/html"
import { backgroundScript, injectScript } from "@/core/messaging"
import { currentPage, getCurrentPage, pageInit, pageReset, setCurrentPage, updatePageCSS } from "@/core/page"
import { query } from "@/core/query"

import { SETTINGS } from "@/feat/settings"
import { SHARED_DATA } from "@/feat/sharedData"
import { RobuxToCash } from "@/feat/robuxToCash"
import { SettingsModal } from "@/feat/settingsModal"
import { startRateLimitNotice } from "@/feat/rateLimitNotice"

import "@/feat/fastSearch"
import "@/feat/navigation"
import "@/feat/contextMenu"
import "@/feat/loadFeature"

import "@/pages/common"
import "@/pages/create"
import { pageLoad } from "@/pages/common"

const PAGE_MODULES: Record<string, () => Promise<unknown>> = {
	avatar: () => import("@/pages/avatar"),
	catalog: () => import("@/pages/catalog"),
	create_dashboard: () => import("@/pages/createDashboard"),
	create_store: () => import("@/pages/createStore"),
	friends: () => import("@/pages/friends"),
	gamedetails: () => import("@/pages/gameDetails"),
	groupadmin: () => import("@/pages/groupAdmin"),
	groups: () => import("@/pages/groups"),
	home: () => import("@/pages/home"),
	inventory: () => import("@/pages/inventory"),
	itemdetails: () => import("@/pages/itemDetails"),
	messages: () => import("@/pages/messages"),
	money: () => import("@/pages/money"),
	profile: () => import("@/pages/profile"),
}

const pageModules: Record<string, Promise<void>> = {}
const loadedPages = new Set<string>()

const loadPageModule = (name: string | undefined): Promise<void> =>
	name && PAGE_MODULES[name]
		? (pageModules[name] ??= PAGE_MODULES[name]()
				.catch((err) => console.error(`[btr] failed to load the ${name} page`, err))
				.then(() => void loadedPages.add(name)))
		: Promise.resolve()

// Started now, alongside reading the settings, which page code waits for
// anyway, so the module is usually in by the time the page starts.
void loadPageModule(getCurrentPage()?.name)

installExtensions()
installRateLimit()
startErrorLog("content")

// The background page reaches these through chrome.scripting.executeScript,
// which cannot see module scope.
window.ReBTRoblox = Object.assign(window.ReBTRoblox ?? {}, { SETTINGS, SettingsModal })

if (IS_DEV_MODE) {
	void import("@/dev/probe").then(({ startDevProbe }) => startDevProbe())
}

// The loader has already verified the document and set btr-loaded.
document.documentElement.setAttribute("btr-loaded", "true")

SETTINGS.load(() => {
	startRateLimitNotice()

	injectScript.init(SETTINGS.serializeForPage(), IS_DEV_MODE, RobuxToCash.getSelectedOption())

	// Keep the page world in step. Hooks there read their settings per call, so
	// this is what lets them change without a reload.
	SETTINGS.onChange(() =>
		injectScript.send("updateSettings", SETTINGS.serializeForPage(), RobuxToCash.getSelectedOption()),
	)

	const initialized: Record<string, boolean> = {}

	const onPageChanged = () => {
		if (currentPage) {
			if (pageReset[currentPage.name]) {
				for (const fn of pageReset[currentPage.name]) {
					try {
						fn.apply(null, currentPage.matches)
					} catch (ex) {
						console.error(ex)
					}
				}
			}
		}

		setCurrentPage(getCurrentPage())

		updatePageCSS()

		if (!initialized.common) {
			initialized.common = true

			if (location.host === "create.roblox.com") {
				try {
					pageInit.create()
				} catch (ex) {
					console.error(ex)
				}
			} else {
				try {
					pageInit.www()
				} catch (ex) {
					console.error(ex)
				}
			}
		}

		if (currentPage) {
			const page = currentPage
			const start = () => {
				// Moved on while its module loaded.
				if (currentPage !== page) {
					return
				}

				if (!initialized[page.name]) {
					initialized[page.name] = true

					if (pageInit[page.name]) {
						try {
							pageInit[page.name]()
						} catch (ex) {
							console.error(ex)
						}
					}
				}

				if (pageLoad[page.name]) {
					for (const fn of pageLoad[page.name]) {
						try {
							fn.apply(null, page.matches)
						} catch (ex) {
							console.error(ex)
						}
					}
				}
			}

			// At once when the module is in, as it is for the first page.
			if (!PAGE_MODULES[page.name] || loadedPages.has(page.name)) {
				start()
			} else {
				void loadPageModule(page.name).then(start)
			}
		}
	}

	injectScript.listen("onPageChanged", onPageChanged)
	onPageChanged()

	if (location.host !== "create.roblox.com") {
		document.$watch("#content", (content: HTMLElement) => {
			const marker = html`<div id="btr-detect-content" style="display:none"></div>`
			content.append(marker)

			new MutationObserver(() => {
				if (!marker.parentNode) {
					content.append(marker)
					onPageChanged()
				}
			}).observe(content, { childList: true })
		})
	}

	SETTINGS.onChange("general.theme", () => updatePageCSS())
})

SHARED_DATA.init()

backgroundScript.send("checkPermissions", (hasPermissions?: boolean) => {
	// No answer says nothing about permissions, so only a no shows the banner.
	if (hasPermissions === false) {
		const oldBanner = query("#btr-permission-banner")
		if (oldBanner) {
			oldBanner.remove()
		}

		const alert = html` <div
			id="btr-permission-banner"
			style="position:fixed;width:100%;height:24px;left:0;top:40px;background:red;color:white;cursor:pointer;z-index:100000;text-align:center;user-select:none;"
		>
			ReBTRoblox needs some permissions to work properly. Click here or click the extension button to
			fix the issue.
		</div>`

		document.$watch(">body").$then((body) => body.append(alert))

		if (IS_CHROME) {
			alert.$on("click", () => {
				backgroundScript.send("requestPermissions", (wasGranted: boolean) => {
					if (wasGranted) {
						location.assign(location.pathname)
					}
				})
			})
		} else {
			alert.textContent = `ReBTRoblox needs some permissions to work properly. Click the extension button to fix the issue.`
			alert.style.cursor = ""
		}
	}
})
