import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { loggedInUser, loggedInUserPromise } from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"
import type { VoiceSettingsResponse } from "@/rbx/types"

const SETTING = "general.voiceChatStatus"

const POLL_INTERVAL = 5 * 60 * 1000
const RETRY_INTERVAL = 60 * 1000

/** How stale the last poll has to be before returning to the tab refetches. */
const STALE_AFTER = 60 * 1000

/**
 * After a ban ends, Roblox can go on answering isBanned with the end time that
 * has already passed. It is checked this often until the flag clears, and for
 * no more than this many checks, after which the normal interval takes over.
 */
const EXPIRED_RECHECK = 20 * 1000
const EXPIRED_RECHECK_LIMIT = 15

/** Past this a timeout fires at once, so long waits are split into polls. */
const MAX_TIMEOUT = 2 ** 31 - 1

type VoiceStateKind = "enabled" | "off" | "ineligible" | "unavailable" | "banned"

interface VoiceState {
	kind: VoiceStateKind
	label: string
	/** Ban end as an epoch timestamp, absent for a ban with no stated end. */
	until?: number | undefined
}

/**
 * A protobuf timestamp, so Seconds is a string and Nanos the sub second
 * remainder, far below anything a countdown shows. The lower case spelling and
 * a plain date string are accepted too, in case the serializer changes.
 */
const readBanEnd = (value: unknown): number | undefined => {
	let ms = Number.NaN

	if (typeof value === "string") {
		ms = Date.parse(value)
	} else if (value && typeof value === "object") {
		const record = value as Record<string, unknown>
		ms = Number(record.Seconds ?? record.seconds) * 1000
	}

	return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/** A ban with an end in the past is over, whatever the flag beside it says. */
const isStaleBan = (settings: VoiceSettingsResponse, now: number) => {
	const until = readBanEnd(settings.bannedUntil)
	return !!settings.isBanned && until !== undefined && until <= now
}

/**
 * isVoiceEnabled is the answer, not a reason: it already folds in eligibility,
 * the opt in, the ban and whatever else. So the narrower fields are read first
 * to say why voice is off, and it only speaks for itself when none of them
 * explain it.
 *
 * Worked out from the response each time it is shown rather than once per
 * poll, so a countdown reaching zero is a ban ending on screen at that moment.
 */
const readState = (settings: VoiceSettingsResponse, now: number): VoiceState => {
	const staleBan = isStaleBan(settings, now)

	if (settings.isBanned && !staleBan) {
		return { kind: "banned", label: "Voice chat banned", until: readBanEnd(settings.bannedUntil) }
	}

	// Roblox only prompts for age verification when it would actually grant
	// voice, so an unverified user is told to verify only when it would help.
	if (settings.isVerifiedForVoice === false) {
		return settings.canVerifyAgeForVoice
			? { kind: "ineligible", label: "Verify your age to use voice chat" }
			: { kind: "ineligible", label: "Not eligible for voice chat" }
	}

	if (settings.isUserEligible === false) {
		return { kind: "ineligible", label: "Not eligible for voice chat" }
	}

	if (settings.isUserOptIn === false) {
		return { kind: "off", label: "Voice chat is off" }
	}

	// Left false by the same stale ban, so it cannot speak for itself here.
	if (settings.isVoiceEnabled === false && !staleBan) {
		return { kind: "unavailable", label: "Voice chat is unavailable" }
	}

	return { kind: "enabled", label: staleBan ? "Voice chat ban has ended" : "Voice chat is on" }
}

const formatRemaining = (ms: number): string => {
	const total = Math.floor(ms / 1000)
	const days = Math.floor(total / 86400)
	const hours = Math.floor((total % 86400) / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const seconds = total % 60

	if (days > 0) {
		return `${days}d ${hours}h`
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`
	}

	return `${seconds}s`
}

// A status readout rather than a control, so it is not a link and carries none
// of the navbar's clickable styling.
const buildItem = () =>
	html` <li id="btr-navbar-voice" class="navbar-icon-item">
		<span class="btr-voice-status">
			<svg class="btr-voice-icon" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 3a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 3Z"></path>
				<path
					class="btr-voice-stroke"
					d="M6.75 10.5a5.25 5.25 0 0 0 10.5 0M12 15.75v3.5M9 19.25h6"
				></path>
				<path class="btr-voice-stroke btr-voice-slash" d="M4.5 4.5 19.5 19.5"></path>
			</svg>
			<span class="btr-voice-timer"></span>
		</span>
	</li>`

let item: HTMLElement | null = null

/** The last response. Null until one arrives, and after a poll fails. */
let settings: VoiceSettingsResponse | null = null

let pollTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

let fetching = false
let lastFetch = 0

/** Checks made so far on a ban that has ended but not yet been cleared. */
let staleChecks = 0

const stopPolling = () => {
	if (pollTimer) {
		clearTimeout(pollTimer)
		pollTimer = null
	}
}

const schedulePoll = (delay: number) => {
	stopPolling()

	pollTimer = setTimeout(
		() => {
			pollTimer = null
			void refresh()
		},
		Math.min(Math.max(delay, 0), MAX_TIMEOUT),
	)
}

/** The countdown only ticks while there is a countdown to tick. */
const setTicking = (ticking: boolean) => {
	if (ticking === !!tickTimer) {
		return
	}

	if (ticking) {
		tickTimer = setInterval(render, 1000)
	} else if (tickTimer) {
		clearInterval(tickTimer)
		tickTimer = null
	}
}

function render(): void {
	if (!item) {
		return
	}

	if (!SETTINGS.get(SETTING) || !settings) {
		item.classList.remove("btr-voice-shown")
		setTicking(false)
		return
	}

	const now = Date.now()
	const state = readState(settings, now)

	const status = item.$req<HTMLElement>(".btr-voice-status")
	const timer = item.$req<HTMLElement>(".btr-voice-timer")

	const remaining = state.until ? state.until - now : 0
	const countdown = state.kind === "banned" && remaining > 0 ? formatRemaining(remaining) : ""

	item.classList.add("btr-voice-shown")

	timer.textContent = countdown
	timer.style.display = countdown ? "" : "none"

	status.classList.toggle("btr-voice-banned", state.kind === "banned")
	status.classList.toggle("btr-voice-muted", state.kind !== "enabled" && state.kind !== "banned")

	status.title =
		state.kind === "banned" && state.until
			? `Voice chat banned until ${new Date(state.until).toLocaleString()}`
			: state.label

	setTicking(!!countdown)
}

/**
 * When to ask again. A running ban is checked the moment it should end, so the
 * next state is shown without waiting out the interval. That is a timeout of
 * its own rather than the countdown noticing, which a background tab throttles
 * to once a minute and stops entirely once the countdown is hidden.
 */
const nextPollDelay = (now: number): number => {
	if (!settings) {
		return RETRY_INTERVAL
	}

	if (isStaleBan(settings, now)) {
		staleChecks++
		return staleChecks <= EXPIRED_RECHECK_LIMIT ? EXPIRED_RECHECK : POLL_INTERVAL
	}

	staleChecks = 0

	const until = settings.isBanned ? readBanEnd(settings.bannedUntil) : undefined
	if (until !== undefined) {
		return Math.min(POLL_INTERVAL, until - now + 1000)
	}

	return POLL_INTERVAL
}

async function refresh(): Promise<void> {
	if (fetching || !SETTINGS.get(SETTING)) {
		return
	}

	fetching = true

	try {
		settings = await RobloxApi.voice.getSettings()
		lastFetch = Date.now()
	} catch (ex) {
		// A failed poll hides the icon rather than showing a state we cannot
		// vouch for, and retries sooner.
		settings = null
	} finally {
		fetching = false
	}

	render()
	schedulePoll(nextPollDelay(Date.now()))
}

const apply = () => {
	if (!SETTINGS.get(SETTING)) {
		stopPolling()
		render()
		return
	}

	render()

	if (!pollTimer && !fetching) {
		void refresh()
	}
}

export const btrVoiceStatus = {
	async init(): Promise<void> {
		await loggedInUserPromise

		if (loggedInUser === -1) {
			return
		}

		document.$watch("#btr-placeholder-voice", (node: HTMLElement) => {
			item = buildItem()
			node.replaceWith(item)
			render()
		})

		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible" && Date.now() - lastFetch > STALE_AFTER) {
				void refresh()
			}
		})

		SETTINGS.onChange(SETTING, apply)

		apply()
	},
}
