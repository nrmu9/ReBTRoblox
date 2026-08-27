import { deferredPromise } from "@/core/deferred"
import type { DeferredPromise } from "@/core/deferred"
import { setImmediate } from "@/core/dom"
import { IS_BACKGROUND_PAGE, IS_CHROME } from "@/core/env"
import { backgroundScript, contentScript } from "@/core/messaging"

export const SHARED_DATA = {
	payloadIndex: undefined as number | undefined,
	payloadScript: undefined as { unregister: () => void } | null | undefined,
	syncLoadError: undefined as string | undefined,
	payloadPromise: undefined as DeferredPromise | undefined,
	_loadPromise: deferredPromise(),
	_loaded: false,

	lastDataString: null as string | null,
	data: { version: 1 },

	updateData() {
		const dataString = JSON.stringify(this.data)

		if (this.lastDataString === dataString) {
			return
		}
		this.lastDataString = dataString

		if (IS_CHROME) {
			const url = new URL("data:,")
			url.searchParams.set("data", dataString)

			chrome.declarativeNetRequest.updateDynamicRules({
				removeRuleIds: [9001],
				addRules: [
					{
						action: { type: "redirect", redirect: { url: url.toString() } },
						condition: { urlFilter: "https://www.roblox.com/?btr_settings" },
						id: 9001,
					},
				],
			})
		} else {
			const thisIndex = (this.payloadIndex = (this.payloadIndex || 0) + 1)

			if (this.payloadScript) {
				this.payloadScript.unregister()
				this.payloadScript = null
			}

			const details = chrome.runtime.getManifest().content_scripts![0]

			browser.contentScripts
				.register({
					matches: details.matches,
					excludeMatches: details.exclude_matches,
					js: [
						{
							code: `const SHARED_DATA_PAYLOAD = ${dataString}; window.ReBTRoblox?.SHARED_DATA?.payloadPromise?.$resolve()`,
						},
					],
					allFrames: details.all_frames,
					runAt: details.run_at,
				})
				.then((payloadScript: any) => {
					if (this.payloadIndex === thisIndex) {
						this.payloadScript = payloadScript
					} else {
						payloadScript.unregister()
					}
				})
		}
	},

	get(key: string) {
		return (this.data as Record<string, any>)[key]
	},

	set(key: string, value: any) {
		;(this.data as Record<string, any>)[key] = value

		if (IS_BACKGROUND_PAGE && this._loaded) {
			setImmediate(() => this.updateData())
		}
	},

	load(fn: (...args: any[]) => void) {
		this._loadPromise.then(fn)
	},

	async init() {
		if (IS_BACKGROUND_PAGE) {
			contentScript.listen({
				getSharedData: (_: any, respond: (value?: any) => void) => {
					respond(this.data)
				},
			})

			this._loaded = true
			this._loadPromise.$resolve()
			return
		}

		if (IS_CHROME) {
			let syncLoadErrorCounter = parseInt(sessionStorage.getItem("syncLoadError") ?? "", 10)
			let dataPayload

			if (!Number.isSafeInteger(syncLoadErrorCounter)) {
				syncLoadErrorCounter = 0
			}

			if (syncLoadErrorCounter < 3) {
				const request = new XMLHttpRequest()
				request.open("HEAD", "https://www.roblox.com/?btr_settings", false)

				try {
					request.send()
					dataPayload = JSON.parse(new URL(request.responseURL).searchParams.get("data") ?? "null")
				} catch (ex) {}
			}

			if (dataPayload instanceof Object) {
				sessionStorage.removeItem("syncLoadError")
			} else {
				sessionStorage.setItem("syncLoadError", String(syncLoadErrorCounter + 1))

				this.syncLoadError =
					typeof (navigator as any).brave === "undefined"
						? `ReBTRoblox failed to initialize properly for an unknown reason.\nSome features may not work properly for the time being.`
						: `ReBTRoblox is currently experiencing issues on the Brave browser.\nSome features may not work properly for the time being.`

				dataPayload = await new Promise((resolve) =>
					backgroundScript.send("getSharedData", (data: any) => resolve(data)),
				)
			}

			Object.assign(this.data, dataPayload)
		} else {
			if (typeof SHARED_DATA_PAYLOAD === "undefined") {
				this.payloadPromise = deferredPromise()
				await this.payloadPromise
			}

			Object.assign(this.data, SHARED_DATA_PAYLOAD)
		}

		this._loaded = true
		this._loadPromise.$resolve()
	},
}

// Published so the registered payload script, which cannot see module scope,
// can resolve payloadPromise once it defines SHARED_DATA_PAYLOAD.
if (!IS_BACKGROUND_PAGE) {
	window.ReBTRoblox = Object.assign(window.ReBTRoblox ?? {}, { SHARED_DATA })
}

if (IS_BACKGROUND_PAGE) {
	SHARED_DATA.init()
}
