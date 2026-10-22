import { html } from "@/core/html"
import type { PresenceSegment } from "@/feat/activity/presence"
import { forceCheck, type ForceTarget } from "@/feat/activity/data"

// Time and layout helpers the activity dialog's tabs share.

// Sightings of the same state closer together than this read as one stretch.
// Pages only check now and then, so someone online all afternoon is seen every
// quarter hour or so, which would otherwise list each sighting on its own.
export const JOIN_GAP = 30 * 60e3

export const DAY = 24 * 60 * 60e3

// When a segment ended: when the next one began if that was seen live,
// otherwise the last time it was seen. The current one runs until now.
export const segmentEnd = (segments: PresenceSegment[], index: number, online: boolean) => {
	const next = segments[index + 1]

	if (!next && online && segments[index].type > 0) {
		return Date.now()
	}

	return next?.exact ? next.from : segments[index].to
}

/** When the user was last seen online, or null if never. */
export const lastSeenAt = (segments: PresenceSegment[]): number | null => {
	for (let i = segments.length; i--;) {
		if (segments[i].type > 0) {
			return segmentEnd(segments, i, false)
		}
	}

	return null
}

export const formatDuration = (ms: number) => {
	const minutes = Math.round(ms / 60e3)

	if (minutes < 1) {
		return "<1m"
	}

	const hours = Math.floor(minutes / 60)
	return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** Time online that falls after `since`. */
export const onlineSince = (segments: PresenceSegment[], online: boolean, since: number) => {
	let total = 0

	segments.forEach((segment, index) => {
		if (segment.type > 0) {
			total += Math.max(0, segmentEnd(segments, index, online) - Math.max(segment.from, since))
		}
	})

	return total
}

/** How long ago, as words: just now, 12 minutes ago, 3 hours ago. */
export const checkedAgo = (at: number) => {
	const minutes = Math.round((Date.now() - at) / 60e3)

	if (minutes < 1) {
		return "just now"
	}

	if (minutes < 60) {
		return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`
	}

	const hours = Math.round(minutes / 60)

	if (hours < 48) {
		return hours === 1 ? "an hour ago" : `${hours} hours ago`
	}

	return `on ${new Date(at).$format("MMM D")}`
}

/** "Friends checked 12 minutes ago, followers an hour ago", from what has run. */
export const checkedLine = (parts: Array<[string, number | undefined]>): string | null => {
	const ran = parts.filter((part): part is [string, number] => !!part[1])

	if (!ran.length) {
		return null
	}

	return ran
		.map(([what, at], i) =>
			i
				? `${what} ${checkedAgo(at)}`
				: `${what[0].toUpperCase()}${what.slice(1)} checked ${checkedAgo(at)}`,
		)
		.join(", ")
}

export const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

// Through the date rather than adding 24 hours, which DST days are not.
export const nextDay = (day: number) => {
	const date = new Date(day)
	date.setDate(date.getDate() + 1)
	return date.getTime()
}

export const dayLabel = (day: number) => {
	if (day === startOfDay(Date.now())) {
		return "Today"
	}

	if (day === startOfDay(Date.now() - DAY)) {
		return "Yesterday"
	}

	// The year only once it is not this one.
	return new Date(day).$format(
		new Date(day).getFullYear() === new Date().getFullYear() ? "DDD, MMM D" : "DDD, MMM D, YYYY",
	)
}

// Long histories are built a page at a time, so a year of it opens as fast
// as a week.
export const PAGE_DAYS = 30
export const PAGE_ROWS = 150
export const shownDays = new WeakMap<HTMLElement, number>()

export const showMore = (label: string, onClick: () => void) => {
	const button = html`<button type="button" class="btr-activity-more">${label}</button>`
	button.$on("click", onClick)
	return button
}

/** A day heading in a log, a quiet label with a rule after it. */
export const dayHeading = (day: number) => html`<h3 class="btr-log-day">${dayLabel(day)}</h3>`

/**
 * A "Check now" button for a "checked ..." line. `onDone` redraws what it
 * belongs to, as a check that finds nothing new announces no change.
 */
export const checkNowButton = (target: ForceTarget, onDone?: () => void): HTMLButtonElement => {
	const button = html<HTMLButtonElement>`<button type="button" class="btr-track-check-now">
		Check now
	</button>`

	const settle = (text: string) => {
		button.textContent = text
		setTimeout(() => {
			button.disabled = false
			button.textContent = "Check now"
		}, 4000)
	}

	button.$on("click", async () => {
		button.disabled = true
		button.textContent = "Checking…"

		const result = await forceCheck(target)

		if (result?.ok) {
			settle("Checked")
			onDone?.()
		} else if (result?.wait) {
			settle(`Again in ${Math.ceil(result.wait / 1000)}s`)
		} else {
			settle("Could not check")
		}
	})

	return button
}
