import { html } from "@/core/html"
import { assert } from "@/core/util"
import { addNavigationEditor } from "@/feat/settingsPanel/navigation"
import { setupRobuxToCash } from "@/feat/settingsPanel/robuxToCash"
import { SETTINGS } from "@/feat/settings"
import { SHARED_DATA } from "@/feat/sharedData"
import { setupStoredActivity } from "@/feat/settingsPanel/activity"
import { setupBackup } from "@/feat/settingsPanel/backup"
import { setupErrorLog } from "@/feat/settingsPanel/errors"
import { showCurrentNotes } from "@/feat/whatsNew"
import type { ExperimentHint } from "@/feat/experimentHints"
import {
	getSavedExperiments,
	loadExperimentHints,
	resetExperiments,
	robloxExperimentsChanged,
	setupExperimentToolbar,
} from "@/feat/settingsPanel/experiments"
import { addHomeRows, addHomeSections } from "@/feat/settingsPanel/homeRows"
import { settingsMarkup } from "@/feat/settingsPanel/markup"
import { bindResetButtons, confirmClick, createRows } from "@/feat/settingsPanel/rows"
import { buildPages, followTabKeys } from "@/feat/settingsPanel/pages"
import { addUnlistedSettings } from "@/feat/settingsPanel/unlisted"
import { setupSearch } from "@/feat/settingsPanel/search"
import { setupReloadPrompt } from "@/feat/settingsPanel/reload"
import { upgradeSelects } from "@/feat/settingsPanel/select"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The settings panel itself, loaded the first time it opens. What opens it is
// in settingsModal.ts, which stays small as it is on every page.
export const SettingsPanel: SettingsModalState = {
	enabled: false,

	toggle(force: boolean) {
		assert(this.enabled, "not enabled")
		this.init()

		// Tracked rather than derived from the parent: the node stays attached
		// while the close transition plays, so reopening inside that window used to
		// read as still visible and toggle straight back off.
		const visible = typeof force === "boolean" ? force : !this.visible
		this.visible = visible

		if (visible) {
			document.$watch(">body", (body: HTMLElement) => {
				if (!this.visible) {
					return
				}

				body.appendChild(this.settingsDiv)

				for (const icon of this.settingsDiv.$findAll(".icon")) {
					icon.classList.toggle("btr-icon-missing", getComputedStyle(icon).maskImage === "none")
				}

				// The open class has to land on a later frame than the mount, or the
				// starting state never paints and there is nothing to transition from.
				requestAnimationFrame(() => {
					if (this.visible) {
						this.settingsDiv.classList.add("btr-settings-open")
					}
				})
			})

			if (location.hostname === "create.roblox.com") {
				this.settingsDiv.classList.add("btr-dark-theme")
			} else {
				const copyThemeFromElement = (target: any) => {
					this.settingsDiv.classList.toggle(
						"btr-light-theme",
						target.classList.contains("light-theme"),
					)
					this.settingsDiv.classList.toggle(
						"btr-dark-theme",
						target.classList.contains("dark-theme"),
					)
				}

				document.$watch(
					".light-theme:not(.btr-settings-modal), .dark-theme:not(.btr-settings-modal)",
					(target: any) => {
						if (this.themeObserver || !this.settingsDiv.parentNode) {
							return
						}

						this.themeObserver = new MutationObserver(() => copyThemeFromElement(target))
						this.themeObserver.observe(target, { attributeFilter: ["class"], attributes: true })
						copyThemeFromElement(target)
					},
				)
			}

			const lastContentOpen = sessionStorage.getItem("btr-settings-open")
			if (lastContentOpen && this.contentDivs[lastContentOpen]) {
				this.switchContent(lastContentOpen)
			} else {
				this.switchContent("main")
			}
		} else {
			this.switchContent("main")

			sessionStorage.removeItem("btr-settings-open")

			// Stay mounted until the fade out finishes. transitionend alone would
			// strand the node if the animation never runs, so a timer backs it up.
			this.settingsDiv.classList.remove("btr-settings-open")

			const unmount = () => {
				if (!this.visible) {
					this.settingsDiv.remove()
				}
			}

			this.settingsDiv.addEventListener("transitionend", unmount, { once: true })
			setTimeout(unmount, 320)

			if (this.themeObserver) {
				this.themeObserver.disconnect()
				this.themeObserver = null
			}
		}
	},

	switchContent(name: string) {
		assert(this.enabled, "not enabled")

		// "main" is what older sessions stored for the front page.
		if (name === "main" || !this.contentDivs?.[name]) {
			name = "general"
		}

		if (this.currentContent === name && !this.searching) {
			return
		}

		this.clearSearch?.()

		for (const [pageName, page] of Object.entries(this.contentDivs) as [string, HTMLElement][]) {
			page.classList.toggle("selected", pageName === name)
		}

		for (const tab of this.settingsDiv.$findAll(".btr-settings-tab")) {
			const selected = tab.dataset.page === name
			tab.classList.toggle("selected", selected)
			tab.setAttribute("aria-selected", String(selected))
			tab.tabIndex = selected ? 0 : -1
		}

		this.settingsDiv.$req(".btr-settings-title").textContent = this.contentDivs[name].dataset.label
		this.settingsDiv.$req(".btr-settings-body").scrollTop = 0

		this.currentContent = name
		sessionStorage.setItem("btr-settings-open", name)

		if (name === "advanced") {
			this.loadExperimentHints()
		} else if (name === "activity") {
			void this.refreshActivity?.()
		}
	},

	init() {
		assert(this.enabled, "not enabled")
		if (this.settingsDiv) {
			return
		}

		this.settingsDiv = settingsMarkup()

		const body: HTMLElement = this.settingsDiv.$req(".btr-settings-body")

		for (const [text, failed] of [
			["Settings failed to load, so changes may not save.", SETTINGS.loadError],
			[SHARED_DATA.syncLoadError, SHARED_DATA.syncLoadError],
		]) {
			if (failed) {
				body.prepend(html`<div class="btr-settings-alert">${text}</div>`)
			}
		}

		// Closing

		this.settingsDiv.$on("click", (ev: MouseEvent) => {
			if (ev.target === this.settingsDiv) {
				this.toggle(false)
			}
		})

		// Real key presses only: the account menu item closes Roblox's menu with a
		// synthetic Escape, which would take the panel down with it.
		document.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Escape" && ev.isTrusted && this.visible && !ev.defaultPrevented) {
				this.toggle(false)
			}
		})

		// Rows

		const rows = createRows()

		// Pages

		const tabs = buildPages(this, rows)
		followTabKeys(this, tabs)

		addNavigationEditor(this)
		addHomeRows(this, rows)
		addHomeSections(this, rows)
		setupRobuxToCash(this)

		confirmClick(this.settingsDiv.$req("#btr-reset-settings"), () => SETTINGS.resetToDefault())

		setupStoredActivity(this)
		setupBackup(this)
		setupErrorLog(this)
		this.settingsDiv.$req(".btr-settings-brand-version").$on("click", () => showCurrentNotes())
		addUnlistedSettings(this, rows)
		bindResetButtons(this)
		setupSearch(this)
		setupReloadPrompt(this)
		upgradeSelects(this)
		setupExperimentToolbar(this)

		this.robloxExperimentsChanged()
	},

	experiments: {},

	getSavedExperiments() {
		return getSavedExperiments()
	},

	experimentHints: null as Record<string, ExperimentHint> | null,
	loadingHints: false,

	loadExperimentHints() {
		loadExperimentHints(this)
	},

	robloxExperimentsChanged() {
		robloxExperimentsChanged(this)
	},

	resetExperiments() {
		resetExperiments(this)
	},
}
