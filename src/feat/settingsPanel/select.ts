import { html } from "@/core/html"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The dropdown that stands in for each select in the panel.

// Dropdowns, in the style of Roblox's own menus. The native select stays,
// hidden, as the one place the value lives, so everything that reads or
// sets it keeps working; the button and menu only mirror it.
export const upgradeSelects = (state: SettingsModalState) => {
	const modal: HTMLElement = state.settingsDiv
	const body: HTMLElement = modal.$req(".btr-settings-body")

	const menu = html`<div class="btr-dropdown-menu" role="listbox" tabindex="-1" hidden></div>`
	modal.append(menu)

	let owner: HTMLSelectElement | null = null
	let ownerButton: HTMLButtonElement | null = null
	let active = -1
	let closeTimer: ReturnType<typeof setTimeout> | undefined

	const options = () => [...menu.children] as HTMLElement[]

	const setActive = (index: number) => {
		const items = options()
		active = Math.max(0, Math.min(items.length - 1, index))

		items.forEach((item, i) => item.classList.toggle("btr-dropdown-active", i === active))
		items[active]?.scrollIntoView({ block: "nearest" })
	}

	const close = (focusButton = false) => {
		if (!owner) {
			return
		}

		ownerButton!.setAttribute("aria-expanded", "false")

		if (focusButton) {
			ownerButton!.focus()
		}

		owner = null
		ownerButton = null
		menu.classList.remove("btr-dropdown-open")

		clearTimeout(closeTimer)
		closeTimer = setTimeout(() => {
			if (!owner) {
				menu.hidden = true
			}
		}, 150)
	}

	const choose = (index: number) => {
		const select = owner
		const item = options()[index]

		close(true)

		if (select && item && select.value !== item.dataset.value) {
			select.value = item.dataset.value!
			select.dispatchEvent(new Event("change"))
		}
	}

	const open = (select: HTMLSelectElement, button: HTMLButtonElement) => {
		clearTimeout(closeTimer)
		owner = select
		ownerButton = button
		button.setAttribute("aria-expanded", "true")

		menu.replaceChildren()

		for (const option of select.options) {
			const item = html`<div class="btr-dropdown-option" role="option">
				<span class="btr-dropdown-option-label">${option.textContent?.trim() ?? ""}</span>
			</div>`

			item.dataset.value = option.value
			item.setAttribute("aria-selected", String(option.selected))
			item.title = option.title || option.textContent?.trim() || ""

			item.$on("pointermove", () => setActive(options().indexOf(item)))
			item.$on("click", () => choose(options().indexOf(item)))
			menu.append(item)
		}

		// Below the button, or above when that has more room, and never
		// narrower than the button itself.
		const rect = button.getBoundingClientRect()
		const below = innerHeight - rect.bottom - 16
		const above = rect.top - 16
		const up = below < 240 && above > below

		menu.hidden = false
		menu.style.minWidth = `${rect.width}px`
		menu.style.maxHeight = `${Math.min(320, up ? above : below)}px`
		menu.style.left = `${Math.min(rect.left, innerWidth - menu.offsetWidth - 16)}px`
		menu.style.top = up ? "" : `${rect.bottom + 4}px`
		menu.style.bottom = up ? `${innerHeight - rect.top + 4}px` : ""
		menu.classList.toggle("btr-dropdown-up", up)

		setActive(select.selectedIndex)
		requestAnimationFrame(() => {
			if (owner === select) {
				menu.classList.add("btr-dropdown-open")
			}
		})
	}

	// Capture, so Escape closes the menu before it can close the dialog.
	document.addEventListener(
		"keydown",
		(ev: KeyboardEvent) => {
			if (!owner) {
				return
			}

			const count = options().length
			let handled = true

			switch (ev.key) {
				case "ArrowDown":
					setActive(active + 1)
					break
				case "ArrowUp":
					setActive(active - 1)
					break
				case "Home":
					setActive(0)
					break
				case "End":
					setActive(count - 1)
					break
				case "Enter":
				case " ":
					choose(active)
					break
				case "Escape":
					close(true)
					break
				case "Tab":
					close()
					handled = false
					break
				default: {
					// Type a letter to jump to the next option starting with it.
					const key = ev.key.length === 1 ? ev.key.toLowerCase() : ""
					const items = options()
					const next = key
						? [...items.slice(active + 1), ...items.slice(0, active + 1)].find((item) =>
								item.textContent?.trim().toLowerCase().startsWith(key),
							)
						: null

					if (next) {
						setActive(items.indexOf(next))
					} else {
						handled = false
					}
				}
			}

			if (handled) {
				ev.preventDefault()
				ev.stopPropagation()
			}
		},
		true,
	)

	document.addEventListener(
		"pointerdown",
		(ev: Event) => {
			if (owner && !menu.contains(ev.target as Node) && !ownerButton!.contains(ev.target as Node)) {
				close()
			}
		},
		true,
	)

	body.addEventListener("scroll", () => close(), { passive: true })
	window.addEventListener("resize", () => close())

	const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!

	const upgradeSelect = (select: HTMLSelectElement) => {
		const button = html<HTMLButtonElement>`<button
			type="button"
			class="btr-dropdown"
			aria-haspopup="listbox"
			aria-expanded="false"
		>
			<span class="btr-dropdown-label"></span>
			<span class="btr-dropdown-chevron" aria-hidden="true"></span>
		</button>`

		if (select.id) {
			button.id = select.id
			select.removeAttribute("id")
		}

		const ariaLabel = select.getAttribute("aria-label")
		if (ariaLabel) {
			button.setAttribute("aria-label", ariaLabel)
		}

		select.tabIndex = -1
		select.after(button)

		const refresh = () => {
			const selected = select.selectedOptions[0]
			button.$req(".btr-dropdown-label").textContent = selected?.textContent?.trim() ?? ""
			button.title = selected?.title || selected?.textContent?.trim() || ""
			button.disabled = select.disabled
		}

		// The rest of the panel sets the value directly, which fires no
		// event, so the setter itself tells the button.
		Object.defineProperty(select, "value", {
			configurable: true,
			get: () => nativeValue.get!.call(select),
			set: (value) => {
				nativeValue.set!.call(select, value)
				refresh()
			},
		})

		new MutationObserver(refresh).observe(select, {
			attributes: true,
			attributeFilter: ["disabled"],
			childList: true,
			subtree: true,
		})

		button.$on("click", () => (owner === select ? close() : open(select, button)))
		button.$on("keydown", (ev: KeyboardEvent) => {
			if (!owner && ["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) {
				ev.preventDefault()
				open(select, button)
			}
		})

		refresh()
	}

	for (const select of modal.$findAll<HTMLSelectElement>(".btr-select select")) {
		upgradeSelect(select)
	}

	state.upgradeSelect = upgradeSelect
}
