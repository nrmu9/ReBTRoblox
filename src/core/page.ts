import { SETTINGS } from "@/feat/settings"

// Page registry and stylesheet management, split out of the legacy js/main.js.

export let currentPage: any = null

export const setCurrentPage = (page: any): void => {
	currentPage = page
}

// Populated by the page modules in src/pages.
export const pageInit: Record<string, (...args: any[]) => void> = {}
export const pageReset: Record<string, ((...args: any[]) => void)[]> = {}

export const PAGE_INFO: Record<string, any> = {
	avatar: {
		matches: ["^/my/avatar"],
		js: ["pages/avatar.js"],
		css: ["avatar.css"],
	},
	catalog: {
		matches: ["^/catalog/?$"],
		js: ["pages/avatar.js"],
		css: ["catalog.css"],
	},
	friends: {
		matches: ["^/users/(\\d+)/friends", "^/users/friends"],
		js: ["pages/friends.js"],
		css: [],
	},
	gamedetails: {
		matches: ["^/games/(\\d+)/"],
		js: ["pages/gamedetails.js"],
		css: ["gamedetails.css"],
	},
	games: {
		matches: ["^/(games|discover)/?$"],
		js: [],
		css: ["games.css"],
	},
	groups: {
		matches: ["^/groups/(\\d+)/*", "^/communities/(\\d+)/*"],
		js: ["pages/groups.js"],
		css: ["groups.css"],
	},
	groupadmin: {
		matches: ["^/groups/configure$", "^/communities/configure$"],
		js: ["pages/groupadmin.js"],
		css: [],
	},
	home: {
		matches: ["^/home"],
		js: ["pages/home.js"],
		css: ["home.css"],
	},
	inventory: {
		matches: ["^/users/(\\d+)/inventory"],
		js: ["pages/inventory.js"],
		css: ["inventory.css"],
	},
	itemdetails: {
		matches: ["^/(catalog|library|game-pass|badges|bundles)/(\\d+)/"],
		js: ["pages/itemdetails.js"],
		css: ["itemdetails.css"],
	},
	membership: {
		matches: ["^/premium/membership"],
		js: [],
		css: [],
	},
	messages: {
		matches: ["^/my/messages"],
		js: ["pages/messages.js"],
		css: ["messages.css"],
	},
	money: {
		matches: ["^/transactions"],
		js: ["pages/money.js"],
		css: ["money.css"],
	},
	profile: {
		matches: ["^/users/(\\d+)/profile"],
		js: ["pages/profile.js"],
		css: ["profile.css"],
	},
	universeconfig: {
		matches: ["^/universes/configure"],
		js: [],
		css: ["universeconfig.css"],
	},

	create_dashboard: {
		domainMatches: ["create.roblox.com"],
		matches: ["^/dashboard/"],
		js: ["pages/create_dashboard.js"],
		css: ["create_dashboard.css"],
	},
	create_store: {
		domainMatches: ["create.roblox.com"],
		matches: ["^/store/"],
		js: ["pages/create_store.js"],
		css: ["create_store.css"],
	},
}

//

const activeStyleSheets: Record<string, HTMLLinkElement> = {}
const reloadingStyleSheets: Record<string, number> = {}

export const startReloadingCSS = (path: string, skipFirst?: boolean) => {
	if (reloadingStyleSheets[path]) {
		return
	}

	const styleSheet = activeStyleSheets[path]
	if (!styleSheet) {
		return
	}

	const key = Date.now()
	reloadingStyleSheets[path] = key

	let lastCssText: string | undefined

	setInterval(async () => {
		if (reloadingStyleSheets[path] !== key) {
			return
		}
		if (document.visibilityState === "hidden") {
			return
		}
		if (!chrome.runtime?.id) {
			return
		} // Stop if extension context is invalidated

		const newUrl = `${chrome.runtime.getURL(path)}?_=${Date.now()}`

		const res = await fetch(newUrl)
		const cssText = await res.text()

		if (reloadingStyleSheets[path] !== key) {
			return
		}

		if (lastCssText !== cssText && (lastCssText || !skipFirst)) {
			styleSheet.href = newUrl
		}

		lastCssText = cssText
	}, 2000)
}

export const insertCSS = (...paths: string[]) => {
	for (const path of paths) {
		if (activeStyleSheets[path]) {
			continue
		}

		const styleSheet = document.createElement("link")
		styleSheet.href = SETTINGS.get("general.themeHotReload")
			? `${chrome.runtime.getURL(path)}?_=${Date.now()}`
			: chrome.runtime.getURL(path)
		styleSheet.rel = "stylesheet"

		const parent = document.head || document.documentElement
		parent.append(styleSheet)

		activeStyleSheets[path] = styleSheet

		if (SETTINGS.get("general.themeHotReload")) {
			startReloadingCSS(path, true)
		}
	}
}

export const removeCSS = (...paths: string[]) => {
	for (const path of paths) {
		const styleSheet = activeStyleSheets[path]
		if (!styleSheet) {
			continue
		}

		styleSheet.remove()
		delete activeStyleSheets[path]
		delete reloadingStyleSheets[path]
	}
}

//

let currentPageCSS: string[] = []

export const updatePageCSS = () => {
	const cssFiles = ["main.css", "settingsmodal.css"]

	if (location.host === "create.roblox.com") {
		cssFiles.push("create.css")
	}

	if (currentPage?.css) {
		cssFiles.push(...currentPage.css)
	}

	const theme = SETTINGS.get("general.theme")

	if (theme !== "default") {
		cssFiles.push(...cssFiles.map((path) => `${theme}/${path}`))
	}

	insertCSS(...cssFiles.map((path) => `css/${path}`))
	removeCSS(...currentPageCSS.filter((path) => !cssFiles.includes(path)).map((path) => `css/${path}`))

	currentPageCSS = cssFiles
}

export const getCurrentPage = (): any => {
	for (const [name, page] of Object.entries(PAGE_INFO) as [string, any][]) {
		const domainMatches = page.domainMatches ?? ["www.roblox.com", "web.roblox.com"]

		if (!domainMatches.includes(location.hostname)) {
			continue
		}

		for (let pattern of page.matches) {
			// locale prefixed urls
			if (pattern.startsWith("^")) {
				pattern = `^(?:/\w{2}|/\w{2}-\w{2,3})?${pattern.slice(1)}`
			}

			const matches = location.pathname.match(new RegExp(pattern, "i"))
			if (matches) {
				return { ...page, name, matches: matches.slice(1) }
			}
		}
	}

	return null
}
