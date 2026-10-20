import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import { joinPaths, makeReset, makeRow, makeSwitch, type Rows } from "@/feat/settingsPanel/rows"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// Turns each <page> of the markup into a page of cards with a tab to open it.

export const buildPages = (
	modal: SettingsModalState,
	{ nextId, settingsDone, buildToggle, buildChoice }: Rows,
) => {
	modal.contentDivs = {}
	const tabs = modal.settingsDiv.$req(".btr-settings-tabs")

	for (const pageElem of modal.settingsDiv.$findAll("page")) {
		const name = pageElem.getAttribute("name")!
		const label = pageElem.getAttribute("label") ?? name
		const groupPath = pageElem.getAttribute("path") ?? ""
		const pageToggle = pageElem.hasAttribute("toggle") ? joinPaths(groupPath, "enabled") : null

		const page = html`<section class="btr-settings-page" role="tabpanel">
			<h3 class="btr-settings-page-title">${label}</h3>
		</section>`
		page.dataset.name = name
		page.dataset.label = label

		// Consecutive rows share a card; a heading starts a new one.
		let card: HTMLElement | null = null
		const cardFor = () => {
			if (!card) {
				card = html`<div class="btr-setting-card"></div>`
				page.append(card)
			}
			return card
		}

		if (pageToggle) {
			settingsDone[pageToggle] = true

			const id = nextId()
			const row = makeRow(
				pageElem.getAttribute("master") ?? `${label} features`,
				pageElem.getAttribute("desc"),
				id,
			)
			const { wrap, input } = makeSwitch(id)

			row.classList.add("btr-setting-master")
			row.dataset.path = pageToggle
			row.append(makeReset(pageToggle), wrap)

			input.$on("change", () => SETTINGS.set(pageToggle, input.checked))

			const update = () => {
				input.checked = !!SETTINGS.get(pageToggle)
				page.classList.toggle("btr-page-disabled", !input.checked)
			}

			SETTINGS.onChange(pageToggle, update)
			update()

			page.append(html`<div class="btr-setting-card btr-setting-card-master"></div>`)
			page.lastElementChild!.append(row)
		}

		for (const child of [...pageElem.children] as HTMLElement[]) {
			const tag = child.tagName.toLowerCase()

			if (tag === "heading") {
				page.append(html`<h4 class="btr-setting-heading">${child.textContent ?? ""}</h4>`)
				card = null
			} else if (tag === "toggle") {
				cardFor().append(buildToggle(child, groupPath, pageToggle))
			} else if (tag === "choice") {
				cardFor().append(buildChoice(child, groupPath, pageToggle))
			} else if (child.classList.contains("btr-setting-row")) {
				cardFor().append(child)
			} else {
				page.append(child)
				card = null
			}
		}

		pageElem.replaceWith(page)
		modal.contentDivs[name] = page

		const tab = html<HTMLButtonElement>`<button type="button" class="btr-settings-tab" role="tab">
			<span class="icon" aria-hidden="true"></span>
			<span class="btr-settings-tab-label">${label}</span>
		</button>`
		tab.dataset.page = name
		tab.firstElementChild!.classList.add(`icon-regular-${pageElem.getAttribute("icon") ?? "gear"}`)
		tab.tabIndex = -1
		tab.$on("click", () => modal.switchContent(name))
		tabs.append(tab)
	}

	return tabs
}

// Arrow keys move between sections, as in any tab list.
export const followTabKeys = (modal: SettingsModalState, tabs: HTMLElement) => {
	tabs.$on("keydown", (ev: KeyboardEvent) => {
		const all = [...tabs.children] as HTMLElement[]
		const index = all.indexOf(document.activeElement as HTMLElement)

		const target =
			ev.key === "ArrowDown"
				? all[(index + 1) % all.length]
				: ev.key === "ArrowUp"
					? all[(index - 1 + all.length) % all.length]
					: ev.key === "Home"
						? all[0]
						: ev.key === "End"
							? all[all.length - 1]
							: null

		if (index !== -1 && target) {
			ev.preventDefault()
			target.focus()
			modal.switchContent(target.dataset.page!)
		}
	})
}
