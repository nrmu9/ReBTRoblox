import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"
import { HOME_ROWS_KEY } from "@/pages/home"
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
