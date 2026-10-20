// Settings and the other state set at document_start from the cache, then replaced once
// init delivers the real ones.

// The hooks run before settings arrive, so the gates the content script would
// have applied are unknown at that point. The last settings handed over are
// kept on the page and read back here, so a disabled feature does not get its
// hooks installed on the next load.
const SETTINGS_CACHE_KEY = "ReBTRoblox:pageSettings"

const readCachedSettings = () => {
	try {
		const json = localStorage.getItem(SETTINGS_CACHE_KEY)
		return json ? JSON.parse(json) : null
	} catch {
		return null
	}
}

export const writeCachedSettings = (value: any) => {
	try {
		localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(value))
	} catch {}
}

export let pageSettings: any = readCachedSettings() ?? {}

// Pages whose Roblox sections the page code replaces. css/early.css hides those
// sections under this attribute, and the browser applies that stylesheet before
// the first paint, so they never flash while the page code is still loading.
// Set here because this runs at document_start with the cached settings.
const EARLY_PAGES: Array<[name: string, path: RegExp, group: string]> = [
	["profile", /^(?:\/[a-z]{2}(?:-[a-z]{2,3})?)?\/users\/\d+\/profile/i, "profile"],
]

export const markEarlyPages = () => {
	const pages = EARLY_PAGES.filter(
		([, path, group]) => path.test(location.pathname) && pageSettings?.[group]?.enabled !== false,
	).map(([name]) => name)

	if (pages.length) {
		document.documentElement.dataset.btrEarly = pages.join(" ")
	} else {
		delete document.documentElement.dataset.btrEarly
	}
}

export let IS_DEV_MODE = false
export let selectedRobuxToCashOption: any = null

export const setPageSettings = (value: any) => {
	pageSettings = value
}

export const setDevMode = (value: boolean) => {
	IS_DEV_MODE = value
}

export const setSelectedRobuxToCashOption = (value: any) => {
	selectedRobuxToCashOption = value
}

// Aliased so the body can keep reading `settings` while the outer binding
// is what init replaces.
export const settings = new Proxy({} as any, {
	get: (_t, key) => pageSettings?.[key],
})

const formatNumber = (num: number | string) => String(num).replace(/(\d\d*?)(?=(?:\d{3})+(?:\.|$))/gy, "$1,") // Intl.NumberFormat().format(num)

export const RobuxToCash = {
	selectedRobuxToCashOption: selectedRobuxToCashOption,

	getSelectedOption() {
		return this.selectedRobuxToCashOption
	},
	isEnabled() {
		const option = this.getSelectedOption()
		return !!option && option.name !== "none"
	},
	convert(robux: number) {
		const option = this.getSelectedOption()

		const cash = Math.round((robux * option.cash) / option.robux + 0.4999) / 100
		const cashString = formatNumber(cash.toFixed(option.currency.numFractions))

		return `${option.currency.symbol}${cashString}`
	},
}
