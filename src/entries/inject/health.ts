// Dev only: how often each hook has matched, keyed by the injected function
// that installed it. dev/health.js reads this to find hooks that stopped
// matching after Roblox changed a page. Production drops all of it.
export const health: Record<string, number> | null = __DEV__ ? ((globalThis as any).__btrHealth = {}) : null
let healthOwner = ""

export const healthKey = (what: string): string => {
	if (!health) {
		return ""
	}

	const key = `${healthOwner || "?"}: ${what}`
	health[key] ??= 0
	return key
}

export const healthHit = (key: string | undefined): void => {
	if (health && key) {
		health[key]++
	}
}

export const setHealthOwner = (name: string) => {
	healthOwner = name
}
