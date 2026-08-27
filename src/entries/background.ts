// Background entry. Owns the content-script port, settings storage, and the
// permission flow; the feature modules register their listeners on import.

import { IS_DEV_MODE, IS_MANIFEST_V3 } from "@/core/env"
import { contentScript } from "@/core/messaging"

import "@/feat/shareddata"
import "@/feat/settings"
import "@/feat/contextmenu"
import "@/feat/serverdetails"
import "@/feat/loadfeature"
import "@/feat/blogfeed"
import "@/rbx/Constants"
import "@/rbx/RobloxApi"

// Service workers need listeners registered synchronously at startup.
chrome.runtime.onStartup.addListener(() => {})
chrome.runtime.onInstalled.addListener(() => {})

const getRequiredPermissions = (): any => {
	const manifest = chrome.runtime.getManifest()

	return {
		origins: [
			...(IS_MANIFEST_V3
				? (manifest.host_permissions ?? [])
				: (manifest.permissions ?? []).filter((x: string) => x.includes("://"))),
			...(manifest.content_scripts?.[0]?.matches ?? []),
		],
	}
}

const browserAction: any = IS_MANIFEST_V3 ? chrome.action : (chrome as any).browserAction

browserAction.onClicked.addListener((tab: chrome.tabs.Tab) => {
	chrome.permissions.request(getRequiredPermissions(), () => {})

	chrome.scripting.executeScript(
		{
			target: { tabId: tab.id! },
			func: () => {
				// window.BTRoblox is published by the content entry; the bundle no
				// longer leaks these as content-script globals.
				const btr = (window as any).BTRoblox

				if (btr?.SettingsModal?.enabled) {
					btr.SETTINGS.load(() => btr.SettingsModal.toggle(true))
					return true
				}
			},
		},
		(results) => {
			void chrome.runtime.lastError // reading it is what clears it

			if (results?.[0]?.result !== true) {
				chrome.tabs.create({ url: "https://www.roblox.com/home?btr_settings_open=true" })
			}
		},
	)
})

contentScript.listen({
	async checkPermissions(_: any, respond: (value?: any) => void) {
		// Can't check all at once because it doesn't handle overlapping permissions properly.
		// i.e. checking for both *.roblox.com and www.roblox.com will return true even if
		// we don't have www.roblox.com permission (which we explicitly need on Chrome to
		// disable extension click-to-enable functionality).

		for (const host of getRequiredPermissions().origins) {
			const contains = await new Promise((resolve) =>
				chrome.permissions.contains({ origins: [host] }, resolve),
			)
			if (!contains) {
				return respond(false)
			}
		}

		respond(true)
	},

	requestPermissions(_: any, respond: (value?: any) => void) {
		chrome.permissions.request(getRequiredPermissions(), respond)
	},
})
if (IS_DEV_MODE) {
	void import("@/dev/bridge").then(({ startDevBridge }) => startDevBridge())
}
