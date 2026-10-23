// Dev only: for lookups inside elements a hook already found, such as a link's
// address or a section's title, which a hook's own count cannot see go
// missing. dev/health.js lists any that never found anything on any page.
const counts: Record<string, number> | null = __DEV__ ? ((globalThis as any).__btrHealth ??= {}) : null

/** Returns `value`, counting whether it was there under `what`. */
export const expectFound = <T>(what: string, value: T): T => {
	if (counts) {
		const key = `expect ${what}`
		counts[key] = (counts[key] ?? 0) + (value ? 1 : 0)
	}

	return value
}
