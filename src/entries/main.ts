// Real content bundle. Loaded by entries/content.ts, which owns the
// document_start guard so this can be code split without losing timing.

// Content script entry.
//
// Import order matters: the $ extensions install first, then the feature and
// page modules register themselves into pageInit/pageReset on import.

import { installExtensions } from "@/core/extend"
import { IS_CHROME, IS_DEV_MODE } from "@/core/env"
import { html } from "@/core/html"
import { backgroundScript, injectScript } from "@/core/messaging"
import { currentPage, getCurrentPage, pageInit, pageReset, setCurrentPage, updatePageCSS } from "@/core/page"
import { query } from "@/core/query"

import { SETTINGS } from "@/feat/settings"
import { SHARED_DATA } from "@/feat/sharedData"
import { RobuxToCash } from "@/feat/robuxToCash"
import { SettingsModal } from "@/feat/settingsModal"

import "@/feat/adblock"
import "@/feat/fastSearch"
import "@/feat/navigation"
import "@/feat/contextMenu"
import "@/feat/loadFeature"
import "@/feat/serverDetails"

import "@/pages/common"
import "@/pages/avatar"
import "@/pages/catalog"
import "@/pages/create"
import "@/pages/createDashboard"
import "@/pages/createStore"
import "@/pages/friends"
import "@/pages/gameDetails"
import "@/pages/groupAdmin"
import "@/pages/groups"
import "@/pages/home"
import "@/pages/inventory"
import "@/pages/itemDetails"
import "@/pages/messages"
import "@/pages/money"
import "@/pages/profile"
import { pageLoad } from "@/pages/common"

installExtensions()

// The background page reaches these through chrome.scripting.executeScript,
// which cannot see module scope.
window.ReBTRoblox = Object.assign(window.ReBTRoblox ?? {}, { SETTINGS, SettingsModal })

if (IS_DEV_MODE) {
	void import("@/dev/probe").then(({ startDevProbe }) => startDevProbe())
}

// The loader has already verified the document and set btr-loaded.
document.documentElement.setAttribute("btr-loaded", "true")

SETTINGS.load(() => {
	injectScript.init(SETTINGS.serialize(), IS_DEV_MODE, RobuxToCash.getSelectedOption())

	// Keep the page world in step. Hooks there read their settings per call, so
	// this is what lets them change without a reload.
	SETTINGS.onChange(() =>
		injectScript.send("updateSettings", SETTINGS.serialize(), RobuxToCash.getSelectedOption()),
	)

	//

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

		injectScript.send(
			"setCurrentPage",
			currentPage ? { name: currentPage.name, matches: currentPage.matches } : null,
		)
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
			if (!initialized[currentPage.name]) {
				initialized[currentPage.name] = true

				if (pageInit[currentPage.name]) {
					try {
						pageInit[currentPage.name]()
					} catch (ex) {
						console.error(ex)
					}
				}
			}

			if (pageLoad[currentPage.name]) {
				for (const fn of pageLoad[currentPage.name]) {
					try {
						fn.apply(null, currentPage.matches)
					} catch (ex) {
						console.error(ex)
					}
				}
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

	//

	SETTINGS.onChange("general.theme", () => updatePageCSS())
})

SHARED_DATA.init()

backgroundScript.send("checkPermissions", (hasPermissions: boolean) => {
	if (!hasPermissions) {
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
