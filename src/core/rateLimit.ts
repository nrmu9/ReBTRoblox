import { STORAGE } from "@/core/env"
import { delay } from "@/core/util"

// When Roblox turns one of our requests away with a 429, every request of
// ours to that site waits until Roblox says to try again, in the pages and the
// background alike, instead of asking again and being turned away again. Only
// our own requests go through here: the page's own are left to Roblox.

export const RATE_LIMITS_KEY = "rateLimits"

/** Until when each Roblox site asked us to hold off, by host. */
export type RateLimits = Record<string, number>

// Waited for when a 429 says nothing about how long, longer each time in a row.
const FALLBACK = [10e3, 30e3, 60e3, 120e3]
// A wait is never longer than this, whatever a header says.
const LONGEST = 5 * 60e3
// A GET turned away is asked again once, if the wait is this short.
const RETRY_WITHIN = 30e3

/**
 * How long a 429 asks us to wait: Retry-After in seconds or as a date, then
 * Roblox's own reset header in seconds, then a pause growing with each 429 in
 * a row that said neither.
 */
export const retryDelay = (
	retryAfter: string | null,
	ratelimitReset: string | null,
	now: number,
	inARow: number,
): number => {
	const clamp = (ms: number) => Math.min(LONGEST, Math.max(1000, ms))

	if (retryAfter) {
		const seconds = Number(retryAfter)

		if (Number.isFinite(seconds)) {
			return clamp(seconds * 1000)
		}

		const at = Date.parse(retryAfter)

		if (Number.isFinite(at)) {
			return clamp(at - now)
		}
	}

	const reset = Number(ratelimitReset)

	if (ratelimitReset && Number.isFinite(reset)) {
		return clamp(reset * 1000)
	}

	return FALLBACK[Math.min(inARow, FALLBACK.length - 1)]
}

const isRoblox = (host: string) => host === "roblox.com" || host.endsWith(".roblox.com")

let limits: RateLimits = {}
const listeners = new Set<(limits: RateLimits) => void>()

const setLimits = (next: RateLimits) => {
	limits = next

	for (const listener of listeners) {
		listener(limits)
	}
}

/** Calls `listener` with the current holds now and whenever they change. */
export const onRateLimits = (listener: (limits: RateLimits) => void): void => {
	listeners.add(listener)
	listener(limits)
}

const hold = (host: string, until: number) => {
	const now = Date.now()
	const next: RateLimits = { [host]: Math.max(until, limits[host] ?? 0) }

	// Holds that have run out are dropped as new ones are written.
	for (const [other, otherUntil] of Object.entries(limits)) {
		if (other !== host && otherUntil > now) {
			next[other] = otherUntil
		}
	}

	setLimits(next)
	STORAGE.set({ [RATE_LIMITS_KEY]: next })
}

/**
 * Dev builds: holds a made-up Roblox host, so the notice shows everywhere
 * while no real request waits.
 */
export const devHold = (seconds: number): void => {
	if (__DEV__) {
		hold("dev-test.roblox.com", Date.now() + seconds * 1000)
	}
}

const urlOf = (input: RequestInfo | URL): URL | null => {
	try {
		return new URL(input instanceof Request ? input.url : String(input), globalThis.location?.href)
	} catch {
		return null
	}
}

/** Routes this world's fetch through the holds. Once per world, before anything asks. */
export const installRateLimit = (): void => {
	const original = globalThis.fetch.bind(globalThis)
	const inARow = new Map<string, number>()

	STORAGE.get(RATE_LIMITS_KEY, (data) => setLimits({ ...(data?.[RATE_LIMITS_KEY] ?? {}), ...limits }))
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes[RATE_LIMITS_KEY]) {
			setLimits((changes[RATE_LIMITS_KEY].newValue as RateLimits | undefined) ?? {})
		}
	})

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const host = urlOf(input)?.hostname ?? ""

		if (!isRoblox(host)) {
			return original(input, init)
		}

		const wait = (limits[host] ?? 0) - Date.now()

		if (wait > 0) {
			await delay(Math.min(wait, LONGEST))
		}

		const res = await original(input, init)

		if (res.status !== 429) {
			inARow.delete(host)
			return res
		}

		const count = inARow.get(host) ?? 0
		inARow.set(host, count + 1)

		const ms = retryDelay(
			res.headers.get("retry-after"),
			res.headers.get("x-ratelimit-reset"),
			Date.now(),
			count,
		)
		hold(host, Date.now() + ms)

		// Asking again for something to read changes nothing on Roblox's side.
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()

		if (method === "GET" && ms <= RETRY_WITHIN && !(input instanceof Request)) {
			await delay(ms)
			return original(input, init)
		}

		return res
	}
}
