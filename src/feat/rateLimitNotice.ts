import { html } from "@/core/html"
import { leave } from "@/core/leave"
import { injectScript } from "@/core/messaging"
import { devHold, onRateLimits } from "@/core/rateLimit"
import { SETTINGS } from "@/feat/settings"

// A small note in the corner while Roblox has asked ReBTRoblox to wait, so a
// check that seems slow, or numbers that stop moving, show why.

const remaining = (seconds: number) =>
	seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

export const startRateLimitNotice = (): void => {
	let note: HTMLElement | null = null
	let timer: ReturnType<typeof setInterval> | undefined
	let until = 0
	// Closed by hand, it stays closed for that wait.
	let dismissed = 0

	const render = () => {
		const left = Math.ceil((until - Date.now()) / 1000)

		if (left <= 0 || until <= dismissed || !SETTINGS.get("general.rateLimitNotice")) {
			leave(note)
			note = null
			clearInterval(timer)
			timer = undefined
			return
		}

		if (!note) {
			note = html`<button type="button" class="btr-rate-limit-note" role="status"></button>`
			note.title =
				"Roblox answered too many requests at once, so ReBTRoblox waits as long as it asked before asking again. Click to hide"
			note.$on("click", () => {
				dismissed = until
				render()
			})
			;(document.body ?? document.documentElement).append(note)
		}

		note.textContent = `Roblox asked ReBTRoblox to wait · ${remaining(left)}`
	}

	onRateLimits((limits) => {
		until = Math.max(0, ...Object.values(limits))

		if (until > Date.now() && !timer) {
			timer = setInterval(render, 1000)
		}

		render()
	})

	SETTINGS.onChange("general.rateLimitNotice", render)

	// Dev builds: btrRateLimit(seconds) in the page console.
	if (__DEV__) {
		injectScript.listen("devRateLimit", (seconds: unknown) => {
			if (typeof seconds === "number" && seconds > 0) {
				devHold(Math.min(seconds, 300))
			}
		})
	}
}
