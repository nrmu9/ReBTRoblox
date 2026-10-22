import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"
import { HOME_ROWS_KEY, HOME_SECTIONS_KEY, sectionLabel } from "@/pages/home"
import { btrLocalStorage } from "@/core/storage"

// The row switches on the Home page.

// Home rows, listed as Home has shown them. A switch per row, kept in
// home.hiddenRows as the topic ids to hide.
export const addHomeRows = (modal: SettingsModalState, { nextId, settingsDone }: Rows) => {
	const placeholder = modal.settingsDiv.$req(".btr-settings-home-rows")
	const card = html`<div class="btr-setting-card"></div>`
	placeholder.replaceWith(card)

	const known = btrLocalStorage.getItem<Record<string, any>>(HOME_ROWS_KEY) ?? {}

	const getHidden = (): string[] => {
		try {
			const list = JSON.parse(SETTINGS.get("home.hiddenRows") || "[]")
			return Array.isArray(list) ? list.map(String) : []
		} catch {
			return []
		}
	}

	const rows = Object.entries(known)

	if (!rows.length) {
		card.append(
			html`<div class="btr-setting-row">
				<div class="btr-setting-text">
					<span class="btr-setting-desc">Open Home once and its rows show up here</span>
				</div>
			</div>`,
		)
	}

	for (const [id, row] of rows) {
		const inputId = nextId()
		const elem = makeRow(`Show ${row.title}`, row.subtitle || null, inputId)
		const { wrap, input } = makeSwitch(inputId)

		elem.dataset.search = "home row hide"
		elem.append(wrap)
		card.append(elem)

		input.$on("change", () => {
			const hidden = new Set(getHidden())

			if (input.checked) {
				hidden.delete(id)
			} else {
				hidden.add(id)
			}

			SETTINGS.set("home.hiddenRows", hidden.size ? JSON.stringify([...hidden]) : "")
		})

		const update = () => {
			input.checked = !getHidden().includes(id)
		}

		SETTINGS.onChange("home.hiddenRows", update)
		update()
	}

	settingsDone["home.hiddenRows"] = true
}

// Home's other sections, such as the friends strip and event banners, a switch
// for each kind seen, kept in home.hiddenSections.
export const addHomeSections = (modal: SettingsModalState, { nextId, settingsDone }: Rows) => {
	const placeholder = modal.settingsDiv.$req(".btr-settings-home-sections")
	const card = html`<div class="btr-setting-card"></div>`
	placeholder.replaceWith(card)

	const known = btrLocalStorage.getItem<Record<string, { example?: string }>>(HOME_SECTIONS_KEY) ?? {}

	const getHidden = (): string[] => {
		try {
			const list = JSON.parse(SETTINGS.get("home.hiddenSections") || "[]")
			return Array.isArray(list) ? list.map(String) : []
		} catch {
			return []
		}
	}

	const sections = Object.entries(known)

	if (!sections.length) {
		card.append(
			html`<div class="btr-setting-row">
				<div class="btr-setting-text">
					<span class="btr-setting-desc">Open Home once and its sections show up here</span>
				</div>
			</div>`,
		)
	}

	for (const [key, section] of sections) {
		const inputId = nextId()
		const elem = makeRow(
			`Show ${sectionLabel(key)}`,
			section.example && key !== "friends" ? `Like "${section.example}"` : null,
			inputId,
		)
		const { wrap, input } = makeSwitch(inputId)

		elem.dataset.search = "home section banner hide"
		elem.append(wrap)
		card.append(elem)

		input.$on("change", () => {
			const hidden = new Set(getHidden())

			if (input.checked) {
				hidden.delete(key)
			} else {
				hidden.add(key)
			}

			SETTINGS.set("home.hiddenSections", hidden.size ? JSON.stringify([...hidden]) : "")
		})

		const update = () => {
			input.checked = !getHidden().includes(key)
		}

		SETTINGS.onChange("home.hiddenSections", update)
		update()
	}

	settingsDone["home.hiddenSections"] = true
}
