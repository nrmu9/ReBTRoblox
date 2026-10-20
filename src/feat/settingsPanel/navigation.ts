import { html } from "@/core/html"
import { Navigation } from "@/feat/navigation"
import { SETTINGS } from "@/feat/settings"
import { makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The switches on the Navigation page, one for each top bar and sidebar button.

// Navigation buttons, which keep their state in navigation.elements
// rather than in a setting each.
export const addNavigationRows = (modal: SettingsModalState, { nextId }: Rows) => {
	const lists: Record<string, HTMLElement> = {}
	for (const list of modal.settingsDiv.$findAll(".btr-settings-nav-list")) {
		const card = html`<div class="btr-setting-card"></div>`
		list.replaceWith(card)
		lists[list.dataset.kind] = card
	}

	const onUpdate: Array<() => void> = []

	const addRow = (element: any, parent: HTMLElement, child: boolean) => {
		const id = nextId()
		const row = makeRow(element.label || element.name, null, id)
		const { wrap, input } = makeSwitch(id)
		const reset = html<HTMLButtonElement>`<button type="button" class="btr-setting-reset">Reset</button>`

		row.classList.toggle("btr-setting-child", child)
		row.append(reset, wrap)
		parent.append(row)

		input.$on("change", () => element.setEnabled(input.checked))
		reset.$on("click", () => element.setEnabled(null))

		onUpdate.push(() => {
			input.checked = element.enabled
			reset.classList.toggle("btr-setting-reset-shown", !element.isDefault)
		})

		return { row, input }
	}

	for (const element of Object.values(Navigation.elements) as any[]) {
		if (element.parent) {
			continue
		}

		const parent = element.name.startsWith("header") ? lists.header : lists.sidebar
		addRow(element, parent, false)

		for (const setting of Object.values(element.settings ?? {}) as any[]) {
			const sub = addRow(setting, parent, true)

			onUpdate.push(() => {
				sub.row.classList.toggle("btr-setting-disabled", !element.enabled)
				sub.input.disabled = !element.enabled
			})
		}
	}

	const update = () => {
		for (const fn of onUpdate) {
			fn()
		}
	}

	SETTINGS.onChange("navigation.elements", update)
	update()
}
