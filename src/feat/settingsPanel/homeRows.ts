import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"
import { HOME_ROWS_KEY, HOME_SECTIONS_KEY, sectionLabel } from "@/pages/home"
import { btrLocalStorage } from "@/core/storage"
import { applyRowOrder, parseRowOrder } from "@/feat/homeOrder"
import { eyeButton, gripIcon, sortable } from "@/feat/settingsPanel/navigation"

// The row switches on the Home page.

// Home rows, listed as Home has shown them, in the order Home will show them.
// They are dragged into place like the bars on the Navigation page, and shown
// or hidden with their eye. The order is kept in home.rowOrder and the hidden
// ones in home.hiddenRows, both as topic ids.
export const addHomeRows = (modal: SettingsModalState, { settingsDone }: Rows) => {
	const placeholder = modal.settingsDiv.$req(".btr-settings-home-rows")
	const card = html`<div class="btr-setting-card btr-home-rows">
		<div class="btr-setting-row">
			<div class="btr-setting-text">
				<span class="btr-setting-desc"></span>
			</div>
		</div>
		<ol class="btr-nav-list"></ol>
	</div>`
	placeholder.replaceWith(card)

	const head = card.$req(".btr-setting-row")
	const list = card.$req(".btr-nav-list")
	const known = btrLocalStorage.getItem<Record<string, any>>(HOME_ROWS_KEY) ?? {}

	const getHidden = (): string[] => {
		try {
			const list = JSON.parse(SETTINGS.get("home.hiddenRows") || "[]")
			return Array.isArray(list) ? list.map(String) : []
		} catch {
			return []
		}
	}

	const setHidden = (id: string, hide: boolean) => {
		const hidden = new Set(getHidden())

		if (hide) {
			hidden.add(id)
		} else {
			hidden.delete(id)
		}

		SETTINGS.set("home.hiddenRows", hidden.size ? JSON.stringify([...hidden]) : "")
	}

	// Saving redraws the list, so the moved row's handle gets the focus back.
	let focusKey: string | null = null

	const render = () => {
		const order = parseRowOrder(SETTINGS.get("home.rowOrder"))
		const rows = applyRowOrder(Object.entries(known), ([id]) => id, order)
		const hidden = getHidden()

		head.$req(".btr-setting-desc").textContent = rows.length
			? "Drag rows to reorder Home. Click the eye to show or hide a row."
			: "Open Home once and its rows show up here"
		// Search matches the rows by name through this line.
		head.dataset.search = `home row hide order move ${rows.map(([, row]) => row.title).join(" ")}`

		head.$find(".btr-nav-reset")?.remove()

		if (order.length) {
			const reset = html<HTMLButtonElement>`<button type="button" class="btr-nav-reset">
				Reset order
			</button>`
			reset.$on("click", () => SETTINGS.set("home.rowOrder", ""))
			head.append(reset)
		}

		list.replaceChildren(
			...rows.map(([id, row]) => {
				const shown = !hidden.includes(id)
				const item = html`<li class="btr-nav-item">
					<button type="button" class="btr-nav-grip"></button>
					<div class="btr-nav-text">
						<span class="btr-nav-name">${row.title}</span>
					</div>
				</li>`

				item.dataset.key = id
				item.classList.toggle("btr-nav-item-off", !shown)

				if (row.subtitle) {
					item.$req(".btr-nav-text").append(html`<span class="btr-nav-note">${row.subtitle}</span>`)
				}

				const grip = item.$req<HTMLButtonElement>(".btr-nav-grip")
				grip.append(gripIcon())
				grip.setAttribute("aria-label", `Move ${row.title}: drag, or use the up and down arrow keys`)
				grip.title = "Drag to move"

				item.append(eyeButton(row.title, shown, () => setHidden(id, shown)))
				return item
			}),
		)

		if (focusKey) {
			list.$find<HTMLElement>(
				`.btr-nav-item[data-key="${CSS.escape(focusKey)}"] .btr-nav-grip`,
			)?.focus()
			focusKey = null
		}
	}

	sortable(
		list,
		(keys) => SETTINGS.set("home.rowOrder", JSON.stringify(keys)),
		(key) => (focusKey = key),
	)

	SETTINGS.onChange("home.rowOrder", render)
	SETTINGS.onChange("home.hiddenRows", render)
	render()

	settingsDone["home.hiddenRows"] = true
	settingsDone["home.rowOrder"] = true
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
