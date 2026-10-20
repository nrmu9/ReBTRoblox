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
		css: ["avatar.css"],
	},
	catalog: {
		matches: ["^/catalog/?$"],
		css: ["catalog.css"],
	},
	gamedetails: {
		matches: ["^/games/(\\d+)/"],
		css: ["gamedetails.css"],
	},
	games: {
		matches: ["^/(games|discover)/?$"],
		css: ["games.css"],
	},
	groups: {
		matches: ["^/groups/(\\d+)/*", "^/communities/(\\d+)/*"],
		css: ["groups.css"],
	},
	groupadmin: {
		matches: ["^/groups/configure$", "^/communities/configure$"],
		css: [],
	},
	home: {
		matches: ["^/home"],
		css: ["home.css"],
	},
	inventory: {
		matches: ["^/users/(\\d+)/inventory"],
		css: ["inventory.css"],
	},
	itemdetails: {
		matches: ["^/(catalog|library|game-pass|badges|bundles)/(\\d+)/"],
		css: ["itemdetails.css"],
	},
	messages: {
		matches: ["^/my/messages"],
		css: ["messages.css"],
	},
	money: {
		matches: ["^/transactions"],
		css: [],
	},
	profile: {
		matches: ["^/users/(\\d+)/profile"],
		css: ["profile.css"],
	},

	create_dashboard: {
		domainMatches: ["create.roblox.com"],
		matches: ["^/dashboard/"],
		css: [],
	},
	create_store: {
		domainMatches: ["create.roblox.com"],
		matches: ["^/store/"],
		css: ["create_store.css"],
	},
}

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
				pattern = `^(?:/\\w{2}|/\\w{2}-\\w{2,3})?${pattern.slice(1)}`
			}

			const matches = location.pathname.match(new RegExp(pattern, "i"))
			if (matches) {
				return { ...page, name, matches: matches.slice(1) }
			}
		}
	}

	return null
}
