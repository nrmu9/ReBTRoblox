const manifest = chrome.runtime.getManifest()

export const IS_MANIFEST_V3 = manifest.manifest_version === 3
export const IS_FIREFOX = "browser_specific_settings" in manifest
export const IS_CHROME = !IS_FIREFOX
export const IS_DEV_MODE = manifest.short_name === "ReBTRoblox_DEV"

const scope = self as typeof self & { window?: unknown }
const legacyExtension = chrome.extension as typeof chrome.extension & {
	getBackgroundPage?: () => unknown
}

export const IS_BACKGROUND_PAGE = !scope.window || legacyExtension?.getBackgroundPage?.() === scope.window

export const IS_CONTENT_SCRIPT = !IS_BACKGROUND_PAGE

export const STORAGE = chrome.storage.local

export const THROW_DEV_WARNING = (message: string): void => {
	console.warn(message)

	if (IS_DEV_MODE) {
		alert(message)
	}
}
