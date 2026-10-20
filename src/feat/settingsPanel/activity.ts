import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { loggedInUser } from "@/pages/common"
import { openActivity, setWatched } from "@/feat/activity/dialog"
import {
	clearActivityBefore,
	exportActivity,
	formatBytes,
	getActivityUsage,
	getUserNames,
} from "@/feat/activity/data"
import { confirmClick } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The Activity page's watched people and stored activity.

// Stored activity: how much space it takes, and clearing or exporting it.
export const setupStoredActivity = (modal: SettingsModalState) => {
	const page: HTMLElement = modal.contentDivs.activity
	const row = page.$req(".btr-activity-usage-row")
	const text = page.$req(".btr-activity-usage-text")
	const meter = page.$req(".btr-activity-meter")
	const warning = page.$req(".btr-activity-warning")

	const refresh = async () => {
		const usage = await getActivityUsage()

		if (!usage) {
			text.textContent = "Couldn't read the stored activity"
			return
		}

		const share = usage.limitBytes ? usage.bytes / usage.limitBytes : 0
		const entries = (usage.presence + usage.events).toLocaleString("en-US")
		const since = usage.oldest ? ` since ${new Date(usage.oldest).$format("MMM D, YYYY")}` : ""

		text.textContent =
			`${formatBytes(usage.bytes)}${usage.limitBytes ? ` of ${formatBytes(usage.limitBytes)}` : ""}` +
			` · ${entries} entries${since}`

		meter.hidden = !usage.limitBytes
		meter.$req("span").style.width = `${Math.min(100, share * 100)}%`
		row.dataset.level = share >= 1 ? "full" : share >= 0.8 ? "high" : ""

		warning.hidden = share < 0.8
		warning.textContent =
			share >= 1
				? "Full. New activity isn't recorded until you clear some or raise the limit."
				: "Nearly full. Recording stops once it reaches the limit."
	}

	const watchedCard = page.$req(".btr-activity-watched")

	const refreshWatched = async () => {
		let ids: number[] = []

		try {
			ids = JSON.parse(SETTINGS.get("profile.watchedUsers") || "[]")
		} catch {}

		if (!ids.length) {
			watchedCard.replaceChildren(
				html`<div class="btr-setting-row">
					<span class="btr-setting-desc">No one yet.</span>
				</div>`,
			)
			return
		}

		const names = await getUserNames(ids)

		watchedCard.replaceChildren(
			...ids.map((id) => {
				const user = names.get(id)
				const row = html`<div class="btr-setting-row">
					<div class="btr-setting-text">
						<a class="btr-setting-label" href="/users/${id}/profile"
							>${user?.displayName ?? `User ${id}`}</a
						>
						<span class="btr-setting-desc">${user ? `@${user.name}` : ""}</span>
					</div>
					<button type="button" class="btr-settings-button btr-activity-view">Activity</button>
					<button type="button" class="btr-settings-button">Stop watching</button>
				</div>`

				row.$req(".btr-activity-view").$on("click", () => {
					void openActivity(id, user ? `@${user.name}` : `User ${id}`, () => false)
				})
				row.$req("button:last-child").$on("click", () => setWatched(id, false))
				return row
			}),
		)
	}

	SETTINGS.onChange("profile.watchedUsers", () => void refreshWatched())

	modal.refreshActivity = () => {
		void refreshWatched()
		return refresh()
	}
	// The background works the new limit out first.
	SETTINGS.onChange("profile.activityLimit", () => setTimeout(refresh, 300))

	confirmClick(page.$req(".btr-activity-clear-old"), () => {
		const days = Number(page.$req<HTMLSelectElement>(".btr-activity-age").value)
		void clearActivityBefore(Date.now() - days * 24 * 60 * 60e3).then(refresh)
	})

	confirmClick(page.$req(".btr-activity-clear-all"), () => {
		void clearActivityBefore(null).then(refresh)
	})

	page.$req(".btr-activity-friendlog").$on("click", () => {
		if (loggedInUser > 0) {
			void openActivity(loggedInUser, "You", () => false, { tab: "friends", isOwn: true })
		}
	})

	page.$req(".btr-activity-export").$on("click", async () => {
		const link = document.createElement("a")
		link.href = URL.createObjectURL(await exportActivity())
		link.download = `rebtroblox-activity-${new Date().$format("YYYY-MM-DD")}.json`
		link.click()
		setTimeout(() => URL.revokeObjectURL(link.href), 60e3)
	})
}
