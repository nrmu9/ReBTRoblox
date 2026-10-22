import { html } from "@/core/html"
import { Navigation } from "@/feat/navigation"
import { currentItems, NAV_LISTS, readOrder, saveOrder } from "@/feat/navOrder"
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

// Names for the items Roblox gives no text, by their key.
const ITEM_NAMES: Record<string, string> = {
	"class:navbar-robux": "Robux",
	"id:navbar-robux": "Robux",
	"class:navbar-settings": "Settings",
	"id:navbar-settings": "Settings",
	"class:rbx-navbar-right-search": "Search",
	"id:rbx-navbar-right-search": "Search",
	"class:btr-navbar-voice": "Voice status",
	"id:btr-navbar-voice": "Voice status",
}

const itemName = (key: string, item: HTMLElement) => {
	if (key.startsWith("btr:")) {
		const label = Navigation.elements[key.slice(4).replace(/#\d+$/, "")]?.label

		if (label) {
			return String(label).replace(/^Show /, "")
		}
	}

	const known = ITEM_NAMES[key.replace(/#\d+$/, "")]

	if (known) {
		return known
	}

	// A slot Roblox fills with a different game each time.
	if (key.startsWith("link:/games/")) {
		return "Featured experience"
	}

	// Counts and "New" badges are not part of the name.
	const text = (item.textContent ?? "")
		.replace(/\d[\d,.]*[KMB+]?/g, "")
		.replace(/New$/, "")
		.replace(/\s+/g, " ")
		.trim()

	const control = item.querySelector("a, button")
	return (
		text ||
		control?.getAttribute("aria-label") ||
		control?.getAttribute("title") ||
		key.replace(/^\w+:/, "")
	)
}

const arrow = (direction: "up" | "down") =>
	html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
		<path
			d="${direction === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>`

/** The Order section: each list's items as they are on this page, with buttons to move them. */
export const addNavigationOrder = (modal: SettingsModalState) => {
	const host = modal.settingsDiv.$find(".btr-settings-nav-order")

	if (!host) {
		return
	}

	const render = () => {
		host.replaceChildren()

		for (const list of NAV_LISTS) {
			const items = currentItems(list.name)
			const card = html`<div class="btr-setting-card btr-nav-order"></div>`
			const head = html`<div class="btr-setting-row">
				<div class="btr-setting-text">
					<span class="btr-setting-label">${list.label}</span>
				</div>
			</div>`

			if (readOrder()[list.name]) {
				const reset = html<HTMLButtonElement>`<button
					type="button"
					class="btr-setting-reset btr-setting-reset-shown"
				>
					Reset
				</button>`
				reset.$on("click", () => saveOrder(list.name, null))
				head.append(reset)
			}

			card.append(head)

			if (!items?.length) {
				card.append(
					html`<div class="btr-setting-row btr-setting-child">
						<span class="btr-setting-desc">Not on this page</span>
					</div>`,
				)
				host.append(card)
				continue
			}

			const keys = items.map(({ key }) => key)

			const move = (from: number, to: number) => {
				const next = keys.slice()
				next.splice(to, 0, ...next.splice(from, 1))
				saveOrder(list.name, next)
			}

			items.forEach(({ key, item }, i) => {
				const hidden = getComputedStyle(item).display === "none"
				const row = html`<div class="btr-setting-row btr-setting-child btr-nav-order-row">
					<div class="btr-setting-text">
						<span class="btr-setting-label">${itemName(key, item)}</span>
						${hidden ? html`<span class="btr-setting-desc">Hidden</span>` : ""}
					</div>
				</div>`

				for (const [direction, to] of [
					["up", i - 1],
					["down", i + 1],
				] as const) {
					const button = html<HTMLButtonElement>`<button
						type="button"
						class="btr-settings-icon-button btr-nav-order-move"
						aria-label="Move ${direction}"
						title="Move ${direction}"
					></button>`

					button.append(arrow(direction))
					button.disabled = to < 0 || to >= items.length
					button.$on("click", () => move(i, to))
					row.append(button)
				}

				card.append(row)
			})

			host.append(card)
		}
	}

	SETTINGS.onChange("navigation.order", render)
	SETTINGS.onChange("navigation.elements", render)
	render()

	// The panel can be built before Roblox draws its bars, so the lists are
	// read again each time the page is shown.
	const page = host.closest(".btr-settings-page")

	if (page) {
		new MutationObserver(() => {
			if (page.classList.contains("selected")) {
				render()
			}
		}).observe(page, { attributeFilter: ["class"] })
	}
}
