import { angularHook } from "@/entries/inject/angular"
import { setHealthOwner } from "@/entries/inject/health"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"
import {
	markEarlyPages,
	pageSettings,
	RobuxToCash,
	setDevMode,
	setPageSettings,
	setSelectedRobuxToCashOption,
	writeCachedSettings,
} from "@/entries/inject/state"
import { avatarFunctions } from "@/entries/inject/avatar"
import { catalogFunctions } from "@/entries/inject/catalog"
import { commonFunctions } from "@/entries/inject/common"
import { navigationFunctions } from "@/entries/inject/navigation"
import { homeFunctions } from "@/entries/inject/home"
import { createFunctions } from "@/entries/inject/create"
import { serversFunctions } from "@/entries/inject/servers"
import { gameDetailsFunctions } from "@/entries/inject/gameDetails"
import { groupsFunctions } from "@/entries/inject/groups"
import { profileFunctions } from "@/entries/inject/profile"
import { leave } from "@/core/leave"

// MAIN world script. Self-contained: it shares no module scope with the
// content scripts and talks to them only over btroblox/* CustomEvents.

// Registration cannot wait for the content bundle. That bundle is a dynamic
// import, and on a cold cache it lands after Roblox has already rendered, at
// which point a react hook registered too late never sees the components it was
// meant to transform. So everything here runs at document_start, and only the
// parts that actually read settings wait for btroblox/init.

markEarlyPages()

/** Set once the body below has run, so init can hand over the real settings. */
let applySettings: ((settings: any, isDevMode: boolean, cashOption: any) => void) | null = null

const startInject = () => {
	const injectedFunctions: Record<string, (...args: any[]) => any> = {
		...avatarFunctions,
		...catalogFunctions,
		...commonFunctions,
		...navigationFunctions,
		...homeFunctions,
		...createFunctions,
		...serversFunctions,
		...gameDetailsFunctions,
		...groupsFunctions,
		...profileFunctions,
	}

	// Hooks that install a react or angular interception. They must be
	// registered before Roblox renders, and registering one twice would apply
	// its transform twice, so the content script calling later is a no op.
	//
	// Only put a hook here if it installs something. Anything that acts on the
	// current DOM belongs on demand: listing it here runs it once at
	// document_start, when there is nothing to act on, and the dedupe below
	// then swallows every later call. setupPopovers and refreshInventory
	// were both silently dead that way.
	//
	// The entries after the name are the settings the content script gates
	// the call on. A hook that transforms Roblox's own markup has to honour
	// them: `profile` strips the About, Communities and description sections
	// because the page code rebuilds them, so installing it while the profile
	// feature is off removes them for good. Settings are only known here from
	// the cache in state.ts, so an unknown setting counts as on, which is what
	// happens on the first load after install.
	const EAGER_HOOKS: string[][] = [
		["avatar", "avatar.enabled"],
		["fullRangeBodyColors", "avatar.enabled", "avatar.fullRangeBodyColors"],
		["showOwnedAssets", "catalog.enabled", "catalog.showOwnedAssets"],
		["initReactRobuxToCash", "general.robuxToUSDRate"],
		["cacheRobuxAmount", "general.cacheRobuxAmount"],
		["higherRobuxPrecision", "general.higherRobuxPrecision"],
		["hideFriendActivity", "home.hideFriendActivity"],
		["homeRows"],
		["robloxResponses"],
		["friendActions", "profile.friendLog"],
		["filterGames"],
		["ignoreR6Warning"],
		["hijackAuth"],
		["webpackHook", "create.enabled"],
		["removeAccessoryLimits", "avatar.removeAccessoryLimits"],
		["createAssetOptions", "create.enabled", "create.assetOptions"],
		["createDownloadVersion", "create.enabled", "create.downloadVersion"],
		["marketplacePageChanged", "create.enabled"],
		["gamedetails", "gamedetails.enabled"],
		["groupsModifyLayout", "groups.enabled", "groups.modifyLayout"],
		["showRecommendationPlayerCount", "home.showRecommendationPlayerCount"],
		["instantGameHoverAction", "home.instantGameHoverAction"],
		["inventoryTools", "inventory.enabled", "inventory.inventoryTools"],
		["itemdetails", "itemdetails.enabled"],
		["money", "general.robuxToUSDRate"],
		["profile", "profile.enabled"],
		["fastsearch", "general.fastSearch"],
		["fixChatMessages"],
		["navigation", "navigation.enabled"],
		["voiceStatus"],
	]

	const EAGER_HOOK_NAMES = EAGER_HOOKS.map(([name]) => name)

	// "none" is how the robux conversion says off.
	const isSettingOn = (path: string) => {
		const [group, key] = path.split(".")
		const value = pageSettings?.[group]?.[key]
		return value !== false && value !== "none"
	}

	// These read settings, so they cannot run until init has delivered them.
	const SETTINGS_HOOKS = ["initReactFriends", "experiments", "pagedServers", "favoritesAtTop"]

	const registered = new Set<string>()

	const callInjected = (name: string, args: any[] = []) => {
		const isRegistration = EAGER_HOOK_NAMES.includes(name) || SETTINGS_HOOKS.includes(name)

		if (isRegistration) {
			if (registered.has(name)) {
				return
			}
			registered.add(name)
		}

		setHealthOwner(name)

		try {
			injectedFunctions[name](...args)
		} catch (ex) {
			// The dev probe hooks the content script's console, not this one,
			// so a hook failing in here was invisible. Keep the failures where
			// the bridge can read them.
			if (__DEV__) {
				try {
					const errors = ((globalThis as any).__btrInjectErrors ??= [])
					errors.push(name + ": " + ((ex as Error)?.stack || ex))
				} catch {}
			}

			console.error("[btr] injected function " + name + " failed", ex)

			// For the error log, which this side cannot reach itself.
			contentScript.send("injectError", name, String((ex as Error)?.stack || ex).slice(0, 2000))
		} finally {
			setHealthOwner("")
		}
	}

	contentScript.listen("call", (name: string, args: any[]) => {
		callInjected(name, args)
	})

	// A notice's close buttons answer here as well. This world lasts through
	// an extension reload or update, while the content script that drew the
	// notice does not, and would leave it on the page with buttons that do
	// nothing.
	document.addEventListener("click", (ev) => {
		const close = (ev.target as Element | null)?.closest?.(
			".btr-whatsnew-close, .btr-whatsnew-done, .btr-activity-toast-dismiss",
		)

		leave(close?.closest(".btr-whatsnew, .btr-activity-toast"))
	})

	// Dev builds: shows the What's new card, or the slow-down notice for a
	// number of seconds, from the page console.
	if (__DEV__) {
		;(window as any).btrWhatsNew = (since?: string) => contentScript.send("devWhatsNew", since ?? null)
		;(window as any).btrRateLimit = (seconds = 30) => contentScript.send("devRateLimit", seconds)
	}

	for (const [name, ...gates] of EAGER_HOOKS) {
		if (gates.every(isSettingOn)) {
			callInjected(name)
		}
	}

	applySettings = (newSettings, isDevMode, cashOption) => {
		setPageSettings(newSettings)
		writeCachedSettings(newSettings)
		markEarlyPages()
		setDevMode(isDevMode)
		setSelectedRobuxToCashOption(cashOption)
		RobuxToCash.selectedRobuxToCashOption = cashOption

		for (const name of SETTINGS_HOOKS) {
			callInjected(name)
		}
	}

	// init only fires once, so without this the page world would keep running
	// against the settings it booted with. Every hook that reads through the
	// settings proxy per call picks changes up from here with no reload.
	contentScript.listen("updateSettings", (newSettings: any, cashOption: any) => {
		setPageSettings(newSettings)
		writeCachedSettings(newSettings)
		markEarlyPages()
		setSelectedRobuxToCashOption(cashOption)
		RobuxToCash.selectedRobuxToCashOption = cashOption
	})

	reactHook.init()
	angularHook.init()
}

startInject()

document.addEventListener(
	"btroblox/init",
	(ev) => {
		const [newSettings, isDevMode, cashOption] = (ev as CustomEvent).detail
		applySettings?.(newSettings, isDevMode, cashOption)
	},
	{ once: true },
)
