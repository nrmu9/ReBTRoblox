// Checks for what the page side sends. It shares the page with Roblox's own
// scripts and anything else running there, any of which can send the same
// events, so nothing it sends is taken on trust: wrong shapes are dropped
// before they reach a feature or the activity history.

/** A Roblox id: a whole number above zero. */
export const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

/** Names that would reach an object's prototype if used as a key. */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"])

/** A short string, safe to use as a key in a plain object. */
export const isKey = (value: unknown, max = 200): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= max && !UNSAFE_KEYS.has(value)

export const isText = (value: unknown, max = 500): value is string =>
	typeof value === "string" && value.length <= max

/** An https address on roblox.com. */
export const isRobloxUrl = (value: unknown): value is string => {
	if (typeof value !== "string" || value.length > 2000) {
		return false
	}

	try {
		const url = new URL(value)
		return (
			url.protocol === "https:" &&
			(url.hostname === "roblox.com" || url.hostname.endsWith(".roblox.com"))
		)
	} catch {
		return false
	}
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value)
