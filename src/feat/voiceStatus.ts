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

type VoiceStateKind = "enabled" | "off" | "ineligible" | "unavailable" | "banned"

interface VoiceState {
	kind: VoiceStateKind
	label: string
	/** Ban end as an epoch timestamp, absent for a ban with no stated end. */
	until?: number | undefined
}

/**
 * Eligibility is checked before the opt in and before the platform flag: a
 * user who cannot use voice at all should be told that rather than that they
 * have it switched off.
 */
const readState = (settings: VoiceSettingsResponse): VoiceState => {
	if (settings.isBanned) {
		// Seconds comes back as a string, and Nanos is the sub second remainder,
		// which is far below anything a countdown shows.
		const seconds = Number(settings.bannedUntil?.Seconds ?? 0)

		return {
			kind: "banned",
			label: "Voice chat banned",
			until: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
		}
	}

	if (settings.isUserEligible === false) {
		return { kind: "ineligible", label: "Not eligible for voice chat" }
	}

	if (settings.isUserOptIn === false) {
		return { kind: "off", label: "Voice chat is off" }
	}

	if (settings.isVoiceEnabled === false) {
		return { kind: "unavailable", label: "Voice chat is unavailable" }
	}

	return { kind: "enabled", label: "Voice chat is on" }
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
const buildItem = () => html` <li id="btr-navbar-voice" class="navbar-icon-item">
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
let state: VoiceState | null = null

let pollTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

let fetching = false
let lastFetch = 0

/**
 * Set once a ban's countdown has run out and a refetch has been scheduled for
 * it, so the per second render cannot queue that refetch over and over.
 */
let expiryHandled = false

const isExpired = (value: VoiceState | null) =>
	!!value && value.kind === "banned" && !!value.until && value.until <= Date.now()

const stopPolling = () => {
	if (pollTimer) {
		clearTimeout(pollTimer)
		pollTimer = null
	}
}

const schedulePoll = (delay: number) => {
	stopPolling()

	pollTimer = setTimeout(() => {
		pollTimer = null
		void refresh()
	}, delay)
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

	if (!SETTINGS.get(SETTING) || !state) {
		item.style.display = "none"
		setTicking(false)
		return
	}

	const status = item.$req<HTMLElement>(".btr-voice-status")
	const timer = item.$req<HTMLElement>(".btr-voice-timer")

	const remaining = state.until ? state.until - Date.now() : 0
	const countdown = state.kind === "banned" && remaining > 0 ? formatRemaining(remaining) : ""

	item.style.display = ""

	timer.textContent = countdown
	timer.style.display = countdown ? "" : "none"

	status.classList.toggle("btr-voice-banned", state.kind === "banned")
	status.classList.toggle("btr-voice-muted", state.kind !== "enabled" && state.kind !== "banned")

	status.title =
		state.kind === "banned" && state.until
			? `Voice chat banned until ${new Date(state.until).toLocaleString()}`
			: state.label

	setTicking(!!countdown)

	// The ban is over as far as the countdown is concerned, so ask what replaced
	// it instead of waiting out the rest of the poll interval.
	if (state.kind === "banned" && state.until && remaining <= 0 && !expiryHandled) {
		expiryHandled = true
		schedulePoll(0)
	}
}

async function refresh(): Promise<void> {
	if (fetching || !SETTINGS.get(SETTING)) {
		return
	}

	fetching = true

	try {
		state = readState(await RobloxApi.voice.getSettings())
		lastFetch = Date.now()
	} catch (ex) {
		// A failed poll hides the icon rather than showing a state we cannot
		// vouch for, and retries sooner.
		state = null
	} finally {
		fetching = false
	}

	expiryHandled = isExpired(state)

	render()
	schedulePoll(state ? POLL_INTERVAL : RETRY_INTERVAL)
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
