import { SETTINGS } from "@/feat/settings"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// What opens the settings panel. The panel is a lot of code that only matters
// once it is open, so it is loaded then rather than on every page.

let panel: SettingsModalState | null = null

const loadPanel = () =>
	import("@/feat/settingsPanel/modal").then((module) => {
		panel = module.SettingsPanel
		panel.enabled = true
		return panel
	})

export const SettingsModal = {
	enabled: false,

	toggle(force?: boolean) {
		void loadPanel().then((loaded) => loaded.toggle(force))
	},

	enable() {
		this.enabled = true
		document.$on("click", ".btr-settings-toggle", () => this.toggle())

		// Opens on a given page, for links elsewhere such as Home's hidden rows.
		document.addEventListener("btr-open-settings", (ev: Event) => {
			void loadPanel().then((loaded) => {
				loaded.toggle(true)
				loaded.switchContent((ev as CustomEvent).detail || "general")
			})
		})

		// we only want to remember settings visibility when navigating same-origin or through history
		if (
			sessionStorage.getItem("btr-settings-open") &&
			performance.getEntriesByType("navigation")[0]?.entryType === "navigate"
		) {
			let sameOrigin = false

			try {
				sameOrigin = new URL(document.referrer).host === location.host
			} catch (ex) {}

			if (!sameOrigin) {
				sessionStorage.removeItem("btr-settings-open")
			}
		}

		try {
			const url = new URL(window.location.href)

			if (url.searchParams.get("btr_settings_open")) {
				sessionStorage.setItem("btr-settings-open", "true")

				url.searchParams.delete("btr_settings_open")
				window.history.replaceState(null, "", url.toString())
			}
		} catch (ex) {}

		if (sessionStorage.getItem("btr-settings-open")) {
			this.toggle(true)
		}
	},

	/** Only the open panel shows experiments, so there is nothing to update before it loads. */
	robloxExperimentsChanged() {
		panel?.robloxExperimentsChanged()
	},
}

/**
 * Adds "BTR Settings" to Roblox's account menu, right under its own settings
 * link. Both sites open that menu in a portal react renders on demand, so the
 * menu is found by the link rather than by its label, which is translated.
 * The item is a copy of the link so it keeps Roblox's look.
 */
export const watchSettingsMenu = (settingsLink: string, openActivity?: () => void): void => {
	document.$watchAll(`.foundation-web-menu:has(${settingsLink})`, (menu: HTMLElement) => {
		const link = menu.$find(settingsLink)

		if (!link || menu.$find(".btr-settings-toggle")) {
			return
		}

		// The menu stays open otherwise, over the settings panel. Closed a tick
		// later, as a detached item would no longer reach the toggle handler.
		const closeMenu = () =>
			setTimeout(() => {
				menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
			})

		const copyOfLink = (text: string, className: string) => {
			const item = link.cloneNode(true) as HTMLElement
			item.removeAttribute("href")
			item.classList.add(className)

			const title =
				item.$find(".foundation-web-menu-item-title") ??
				[...item.querySelectorAll("span, div")].findLast(
					(node) => !node.children.length && node.textContent?.trim(),
				)

			if (title) {
				title.textContent = text
			}

			item.$on("click", closeMenu)
			return item
		}

		const item = copyOfLink("BTR Settings", "btr-settings-toggle")
		link.after(item)

		// The activity panel too, for Roblox's own pages, unless turned off.
		if (openActivity && SETTINGS.get("navigation.activityMenu")) {
			const activity = copyOfLink("Activity", "btr-activity-menu-item")
			activity.$on("click", openActivity)
			item.after(activity)
		}
	})
}
