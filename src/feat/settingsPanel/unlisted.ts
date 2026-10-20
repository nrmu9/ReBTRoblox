import { html } from "@/core/html"
import { DEFAULT_SETTINGS, SETTINGS } from "@/feat/settings"
import { makeReset, makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The Unlisted Settings card on the Advanced page.

// Settings with no row of their own, listed so they can still be changed.
export const addUnlistedSettings = (modal: SettingsModalState, { nextId, settingsDone }: Rows) => {
	const wip = modal.settingsDiv.$req("#btr-settings-wip")

	for (const [groupPath, settingsGroup] of Object.entries(SETTINGS.loadedSettings) as [string, any][]) {
		for (const [settingName, settingValueInfo] of Object.entries(settingsGroup) as [string, any][]) {
			const defaultValueInfo = (DEFAULT_SETTINGS as Record<string, any>)[groupPath][settingName]
			const path = `${groupPath}.${settingName}`

			if (settingsDone[path] || defaultValueInfo.hidden) {
				continue
			}

			const value = settingValueInfo.value
			const id = nextId()
			const row = makeRow(path, null, id)
			row.dataset.path = path

			if (typeof value === "boolean") {
				const { wrap, input } = makeSwitch(id)
				row.append(makeReset(path), wrap)

				input.$on("change", () => SETTINGS.set(path, input.checked))
				const update = () => {
					input.checked = !!SETTINGS.get(path)
				}
				SETTINGS.onChange(path, update)
				update()
			} else if (typeof value === "string" && defaultValueInfo.validValues) {
				const select = html<HTMLSelectElement>`<select></select>`
				select.id = id

				for (const valid of defaultValueInfo.validValues) {
					select.append(html<HTMLOptionElement>`<option value="${valid}">${valid}</option>`)
				}

				const wrap = html`<span class="btr-select"></span>`
				wrap.append(select)
				row.append(makeReset(path), wrap)

				select.$on("change", () => SETTINGS.set(path, select.value))
				const update = () => {
					select.value = SETTINGS.get(path)
				}
				SETTINGS.onChange(path, update)
				update()
			} else {
				row.$req(".btr-setting-label").textContent += ` (${typeof value})`
			}

			wip.append(row)
		}
	}

	if (!wip.children.length) {
		wip.previousElementSibling?.remove()
		wip.remove()
	}
}
