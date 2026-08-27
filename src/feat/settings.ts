import { deferredPromise } from "@/core/deferred"
import { IS_BACKGROUND_PAGE, STORAGE } from "@/core/env"
import { backgroundScript, contentScript } from "@/core/messaging"
import { SHARED_DATA } from "@/feat/sharedData"

/**
 * Only settings that differ from their default are written, keyed by path. A
 * new setting therefore needs no migration at all, a removed one disappears on
 * the next write, and the payload stays small enough to rewrite cheaply.
 */
const STORAGE_KEY = "btrSettings"

/**
 * The nested blob written by earlier versions, read once and converted. It is
 * left in place rather than deleted: it costs almost nothing and is the only
 * way back if a converted profile turns out wrong.
 */
const LEGACY_STORAGE_KEY = "settings"

const STORAGE_FORMAT = 3

/** Writes are coalesced over this window so a burst of changes costs one set. */
const SAVE_DEBOUNCE_MS = 120

export const DEFAULT_SETTINGS = {
	loaded: undefined as boolean | undefined,
	firstLoad: undefined as boolean | undefined,
	loadError: undefined as unknown,
	_version: 2,
	general: {
		theme: { value: "default", validValues: ["default", "simblk", "sky", "red"], hidden: true },
		themeHotReload: { value: false, hidden: true },

		hideAds: { value: false },
		hideChat: { value: false },
		smallChatButton: { value: true },
		fastSearch: { value: true },
		voiceChatStatus: { value: true },

		robuxToUSDRate: { value: "none", hidden: true },

		hoverPreview: { value: true },
		hoverPreviewMode: { value: "always", validValues: ["always", "never"] },
		previewLayeredClothing: { value: true },

		cacheRobuxAmount: { value: true },
		higherRobuxPrecision: { value: true },
		enableContextMenus: { value: true },

		experiments: { value: "", hidden: true },
	},
	create: {
		enabled: { value: true, version: 2 },
		assetOptions: { value: false },
		downloadVersion: { value: true },
	},
	home: {
		friendsShowUsername: { value: false },
		friendsSecondRow: { value: false },
		friendPresenceLinks: { value: true },
		favoritesAtTop: { value: false },
		hideFriendActivity: { value: false },
		instantGameHoverAction: { value: false },
		showRecommendationPlayerCount: { value: true },
	},
	messages: {
		enabled: { value: true },
		markAllAsRead: { value: true },
		pageJump: { value: true },
	},
	navigation: {
		enabled: { value: true },
		noHamburger: { value: true },
		elements: { value: "", hidden: true },
	},
	avatar: {
		enabled: { value: true },
		removeAccessoryLimits: { value: true },
		removeLayeredLimits: { value: true },
		fullRangeBodyColors: { value: true },
		assetRefinement: { value: false },
		ignoreR6Warning: { value: false },
	},
	catalog: {
		enabled: { value: true },
		showOwnedAssets: { value: false },
	},
	itemdetails: {
		enabled: { value: true },
		itemPreviewer: { value: true },
		itemPreviewerMode: { value: "always", validValues: ["always", "animations", "never"] },

		explorerButton: { value: true },
		downloadButton: { value: true },
		contentButton: { value: true },

		showSales: { value: true },
		showCreatedAndUpdated: { value: true },

		addOwnersList: { value: true, hidden: true },
	},
	gamedetails: {
		enabled: { value: true },
		showBadgeOwned: { value: true },
		addServerPager: { value: true },
		showServerRegion: { value: "none", validValues: ["none", "ping", "region", "both", "combined"] },
		compactBadgeStats: { value: true },
	},
	groups: {
		enabled: { value: true },
		modifyLayout: { value: true },
	},
	inventory: {
		enabled: { value: true },
		inventoryTools: { value: true },
	},
	profile: {
		enabled: { value: true },
		embedInventoryEnabled: { value: true },
	},
}

for (const list of Object.values(DEFAULT_SETTINGS) as any[]) {
	if (list instanceof Object) {
		for (const setting of Object.values(list) as any[]) {
			setting.default = true
		}
	}
}

export const SETTINGS: Record<string, any> = {
	_onChangeListeners: [],
	_loadPromise: deferredPromise<unknown>(),

	firstLoad: false,
	loaded: false,

	loadedSettings: JSON.parse(
		JSON.stringify(DEFAULT_SETTINGS, (key, value) => (key === "validValues" ? undefined : value)),
	),

	_saveTimer: null as ReturnType<typeof setTimeout> | null,

	/** The sparse form actually written: path to value, defaults omitted. */
	_collectOverrides() {
		const values: Record<string, any> = {}

		for (const [groupName, group] of Object.entries(this.loadedSettings) as [string, any][]) {
			if (!(group instanceof Object)) {
				continue
			}

			for (const [settingName, setting] of Object.entries(group) as [string, any][]) {
				if (!(setting instanceof Object) || setting.default !== false) {
					continue
				}

				const settingPath = `${groupName}.${settingName}`
				const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)

				values[settingPath] =
					defaultSetting?.version === undefined
						? { v: setting.value }
						: { v: setting.value, ver: defaultSetting.version }
			}
		}

		return values
	},

	_save() {
		if (!IS_BACKGROUND_PAGE || !this.loaded || this.loadError) {
			return
		}

		// Coalesced: toggling several settings, or a nav list that rewrites itself
		// per item, used to cost one full write each.
		if (this._saveTimer) {
			return
		}

		this._saveTimer = setTimeout(() => {
			this._saveTimer = null
			this._flush()
		}, SAVE_DEBOUNCE_MS)
	},

	_flush(isRetry = false, onSaved?: () => void) {
		const payload = { format: STORAGE_FORMAT, values: this._collectOverrides() }

		STORAGE.set({ [STORAGE_KEY]: payload }, () => {
			const error = chrome.runtime.lastError

			if (!error) {
				onSaved?.()
				return
			}

			console.warn("[btr] failed to save settings", error.message)

			// One retry covers a transient quota or a write racing shutdown; past
			// that, keep the in memory state rather than dropping the change.
			if (!isRetry) {
				setTimeout(() => this._flush(true, onSaved), 400)
			}
		})
	},

	/** Applies the sparse stored form. Unknown, stale or invalid entries are skipped. */
	_applyStored(stored: any) {
		if (!stored || stored.format !== STORAGE_FORMAT || !(stored.values instanceof Object)) {
			return false
		}

		for (const [settingPath, entry] of Object.entries(stored.values) as [string, any][]) {
			if (!(entry instanceof Object)) {
				continue
			}

			const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)

			// Dropped since this was written, or bumped, so it falls back to default.
			if (!defaultSetting || defaultSetting.version !== entry.ver) {
				continue
			}

			if (!this._isValid(settingPath, entry.v)) {
				continue
			}

			this._set(settingPath, entry.v, false, false)
		}

		return true
	},

	/** Converts the pre v3 nested blob, which stored every setting including defaults. */
	_applyLegacy(data: any) {
		if (!data || data._version !== DEFAULT_SETTINGS._version) {
			return false
		}

		for (const [groupName, group] of Object.entries(data) as [string, any][]) {
			if (!(group instanceof Object)) {
				continue
			}

			for (const [settingName, loadedSetting] of Object.entries(group) as [string, any][]) {
				if (!(loadedSetting instanceof Object) || loadedSetting.default) {
					continue
				}

				const settingPath = `${groupName}.${settingName}`
				const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)

				if (!defaultSetting || defaultSetting.version !== loadedSetting.version) {
					continue
				}

				if (!this._isValid(settingPath, loadedSetting.value)) {
					continue
				}

				this._set(settingPath, loadedSetting.value, false, false)
			}
		}

		return true
	},

	/** The nested snapshot handed to content scripts at document_start. */
	_applyShared(data: any) {
		for (const [groupName, group] of Object.entries(data) as [string, any][]) {
			if (!(group instanceof Object)) {
				continue
			}

			for (const [settingName, sharedSetting] of Object.entries(group) as [string, any][]) {
				if (!(sharedSetting instanceof Object) || sharedSetting.default) {
					continue
				}

				const settingPath = `${groupName}.${settingName}`

				if (!this._getSetting(settingPath, DEFAULT_SETTINGS)) {
					continue
				}

				this._set(settingPath, sharedSetting.value, false, false)
			}
		}

		this._markLoaded()
	},

	_markLoaded() {
		if (!this.loaded) {
			this.loaded = true
			this._loadPromise.$resolve(this.loadedSettings)
		}
	},

	load(fn: (...args: any[]) => void) {
		if (!this.firstLoad) {
			this.firstLoad = true

			if (IS_BACKGROUND_PAGE) {
				STORAGE.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (data) => {
					this.loadError = chrome.runtime.lastError

					if (this.loadError) {
						console.warn("[btr] failed to read settings", this.loadError.message)
					} else if (!this._applyStored(data?.[STORAGE_KEY])) {
						// First run on the new format: fold the old blob in and write it
						// back in the sparse form.
						if (this._applyLegacy(data?.[LEGACY_STORAGE_KEY])) {
							this._markLoaded()
							this._flush()
						}
					}

					this._markLoaded()
				})
			}
		}

		this._loadPromise.then(fn)
	},

	serialize() {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		const settings = JSON.parse(JSON.stringify(this.loadedSettings))
		delete settings._version

		// Change settings to be name: value
		for (const group of Object.values(settings) as any[]) {
			for (const [name, setting] of Object.entries(group) as [string, any][]) {
				group[name] = setting.value
			}
		}

		return settings
	},

	_getSetting(path: string, root: any) {
		const index = path.indexOf(".")
		if (index === -1) {
			return
		}

		const groupName = path.slice(0, index)
		const settingName = path.slice(index + 1)

		const group = root[groupName]
		if (!(group instanceof Object)) {
			return
		}

		const setting = group[settingName]
		if (!(setting instanceof Object && "value" in setting)) {
			return
		}

		return setting
	},

	_isValid(settingPath: string, value: any) {
		const setting = this._getSetting(settingPath, this.loadedSettings)

		if (!setting) {
			return false // Invalid setting
		}

		if (typeof value !== typeof setting.value) {
			return false // Type mismatch
		}

		const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)
		if (defaultSetting.validValues && !defaultSetting.validValues.includes(value)) {
			return false // Invalid value
		}

		return true
	},

	_set(settingPath: string, value: any, isDefault = false, shouldSave = false) {
		if (!this._isValid(settingPath, value)) {
			return false
		}

		const setting = this._getSetting(settingPath, this.loadedSettings)

		if (setting.value === value && !!isDefault === setting.default) {
			return false
		}

		setting.value = value
		setting.default = !!isDefault

		if (this.loaded) {
			if (shouldSave) {
				if (IS_BACKGROUND_PAGE) {
					this._save()
				} else {
					backgroundScript.send("setSetting", { path: settingPath, value, default: !!isDefault })
				}
			}

			const listeners = [
				...(this._onChangeListeners[settingPath] ?? []),
				...(this._onChangeListeners["*"] ?? []),
			]
			for (const fn of listeners) {
				try {
					fn(setting.value, setting.default, settingPath)
				} catch (ex) {
					console.error(ex)
				}
			}
		}

		return true
	},

	hasSetting(settingPath: string) {
		return !!this._getSetting(settingPath, this.loadedSettings)
	},

	get(settingPath: string) {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		const setting = this._getSetting(settingPath, this.loadedSettings)
		if (!setting) {
			throw new TypeError(`'${settingPath}' is not a valid setting`)
		}

		return setting.value
	},

	set(settingPath: string, value: any) {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		if (!this._isValid(settingPath, value)) {
			throw new Error(`Invalid value '${typeof value} ${String(value)}' to '${settingPath}'`)
		}

		const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)

		this._set(settingPath, value, defaultSetting?.value === value, true)
	},

	getIsDefault(settingPath: string) {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		const setting = this._getSetting(settingPath, this.loadedSettings)
		if (!setting) {
			throw new TypeError(`'${settingPath}' is not a valid setting`)
		}

		return setting.default
	},

	reset(settingPath: string) {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		const defaultSetting = this._getSetting(settingPath, DEFAULT_SETTINGS)
		if (!defaultSetting) {
			throw new TypeError(`'${settingPath}' is not a valid setting`)
		}

		const value = defaultSetting.value
		if (!this._isValid(settingPath, value)) {
			throw new Error(`Invalid value '${typeof value} ${String(value)}' to '${settingPath}'`)
		}

		this._set(settingPath, value, true, true)
	},

	resetToDefault() {
		if (!this.loaded) {
			throw new Error("Settings are not loaded")
		}

		for (const [groupName, group] of Object.entries(DEFAULT_SETTINGS) as [string, any][]) {
			if (!(group instanceof Object)) {
				continue
			}

			for (const [settingName, setting] of Object.entries(group) as [string, any][]) {
				this._set(`${groupName}.${settingName}`, setting.value, true, true)
			}
		}

		if (IS_BACKGROUND_PAGE) {
			this.loadError = false
			this._save()
		}
	},

	onChange(settingPath: string | ((...args: any[]) => void), fn?: (...args: any[]) => void) {
		if (typeof settingPath === "function") {
			fn = settingPath
			settingPath = "*"
		}

		if (!this._onChangeListeners[settingPath]) {
			this._onChangeListeners[settingPath] = []
		}

		this._onChangeListeners[settingPath].push(fn)
	},
}

if (IS_BACKGROUND_PAGE) {
	contentScript.listen({
		setSetting(data: any, respond: (value?: any) => void) {
			SETTINGS.load(() => {
				SETTINGS._set(data.path, data.value, data.default, true)
			})

			respond()
		},
	})

	// The payload is what makes settings readable synchronously at
	// document_start, so it is refreshed on every change rather than replaced by
	// an async storage read in the content script.
	SETTINGS.load(() => SHARED_DATA.set("settings", SETTINGS.loadedSettings))
	SETTINGS.onChange(() => SHARED_DATA.set("settings", SETTINGS.loadedSettings))
} else {
	SHARED_DATA.load(() => {
		const shared = SHARED_DATA.get("settings")

		if (shared) {
			SETTINGS._applyShared(shared)
		}
	})
}

// Any context that is already running picks changes up here, so a setting
// changed in one tab reaches the others without a reload.
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local" || !changes[STORAGE_KEY] || !SETTINGS.loaded) {
		return
	}

	const stored = changes[STORAGE_KEY].newValue as
		{ format?: number; values?: Record<string, any> } | undefined

	if (!stored || stored.format !== STORAGE_FORMAT || !(stored.values instanceof Object)) {
		return
	}

	// Anything no longer present in the write has gone back to its default.
	for (const [groupName, group] of Object.entries(SETTINGS.loadedSettings) as [string, any][]) {
		if (!(group instanceof Object)) {
			continue
		}

		for (const [settingName, setting] of Object.entries(group) as [string, any][]) {
			if (!(setting instanceof Object) || setting.default !== false) {
				continue
			}

			if (!(`${groupName}.${settingName}` in stored.values)) {
				SETTINGS.reset(`${groupName}.${settingName}`)
			}
		}
	}

	// _set ignores a value that already matches, so our own write is a no op.
	SETTINGS._applyStored(stored)
})
