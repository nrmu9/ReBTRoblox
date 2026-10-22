import { STORAGE } from "@/core/env"
import { html } from "@/core/html"
import { formatBytes } from "@/feat/activity/data"
import { SETTINGS } from "@/feat/settings"
import { toastArea } from "@/feat/toasts"

// A notice on Roblox pages once the stored activity nears its limit, and
// again when it reaches it and recording stops. Dismissing one hides it until
// the next level.

interface Level {
	level: number
	bytes: number
	limitBytes: number
}

let toast: HTMLElement | null = null

const show = (state: Level | undefined, dismissed: number) => {
	toast?.remove()
	toast = null

	if (!state || state.level <= dismissed || !SETTINGS.get("profile.lastSeen")) {
		return
	}

	const usage = `${formatBytes(state.bytes)} of ${formatBytes(state.limitBytes)}`

	toast = html`<div class="btr-activity-toast" role="status" data-level="${state.level}">
		<div class="btr-activity-toast-text">
			<strong
				>${state.level >= 2 ? "Activity history is full" : "Activity history is nearly full"}</strong
			>
			<span
				>${
					state.level >= 2
						? `It takes ${usage}, so new activity isn't being recorded.`
						: `It takes ${usage}. Recording stops at the limit.`
				}</span
			>
		</div>
		<div class="btr-activity-toast-actions">
			<button type="button" class="btr-activity-toast-manage">Manage</button>
			<button type="button" class="btr-activity-toast-dismiss">Dismiss</button>
		</div>
	</div>`

	toast.$req(".btr-activity-toast-manage").$on("click", () => {
		document.dispatchEvent(new CustomEvent("btr-open-settings", { detail: "activity" }))
	})

	toast.$req(".btr-activity-toast-dismiss").$on("click", () => {
		STORAGE.set({ activityLevelDismissed: state.level })
	})

	toastArea().append(toast)
}

export const watchActivityWarning = (): void => {
	const read = () =>
		STORAGE.get(["activityLevel", "activityLevelDismissed"], (data) =>
			show(data.activityLevel as Level | undefined, Number(data.activityLevelDismissed ?? 0)),
		)

	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local" && (changes.activityLevel || changes.activityLevelDismissed)) {
			// Back under the limit, a later warning should show again.
			if ((changes.activityLevel?.newValue as Level | undefined)?.level === 0) {
				STORAGE.set({ activityLevelDismissed: 0 })
			}

			read()
		}
	})

	document.$watch("body", read)
}
