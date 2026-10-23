// Roblox answers game counts from caches that disagree, so polling it can flip
// a count between an older and a newer value every few seconds. These keep a
// shown count from bouncing, and move it smoothly between samples.

const RECENT = 60e3
// This many samples in a row agreeing is believed, even on a value seen before.
const AGREE = 4

/**
 * Settles a count that can go up or down. A value seen within the last minute,
 * other than the one shown, is taken for a stale cache and ignored, unless the
 * last few samples all agree on it.
 */
export const createSettler = () => {
	const seenAt = new Map<number, number>()
	const lastFew: number[] = []
	let shown: number | undefined

	return (value: number, now: number): number => {
		lastFew.push(value)
		lastFew.splice(0, lastFew.length - AGREE)

		const stale = (seenAt.get(value) ?? -Infinity) > now - RECENT
		const agreed = lastFew.length === AGREE && lastFew.every((sample) => sample === value)

		if (shown === undefined || agreed || (value !== shown && !stale)) {
			shown = value
		}

		seenAt.set(value, now)

		for (const [old, at] of seenAt) {
			if (at <= now - RECENT) {
				seenAt.delete(old)
			}
		}

		return shown
	}
}

/** Where a count moving from `from` to `to` over `duration` is at `elapsed`, in whole steps. */
export const rampValue = (from: number, to: number, elapsed: number, duration: number): number =>
	elapsed >= duration ? to : Math.round(from + (to - from) * Math.max(0, elapsed / duration))
