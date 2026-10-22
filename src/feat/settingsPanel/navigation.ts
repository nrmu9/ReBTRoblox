import { html } from "@/core/html"
import { Navigation } from "@/feat/navigation"
import {
	currentItems,
	NAV_LISTS,
	readHidden,
	readOrder,
	saveOrder,
	setHidden,
	type NavListName,
} from "@/feat/navOrder"
import { SETTINGS } from "@/feat/settings"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The Navigation page: one list per bar, as the bars are on the page settings
// opened over. Items are dragged into place, or moved with the arrow keys on
// their handle, and shown or hidden with their eye. Our own items keep their
// switches in navigation.elements; anything else, Roblox's included, is hidden
// through the order lists' own record.

// Names for the items Roblox gives no text, by their key.
const ITEM_NAMES: Record<string, string> = {
	"class:navbar-robux": "Robux",
	"id:navbar-robux": "Robux",
	"class:navbar-settings": "Settings",
	"id:navbar-settings": "Settings",
	// Roblox's magnifier, only there when the window is too narrow for the search box.
	"class:rbx-navbar-right-search": "Search (narrow windows)",
	"id:rbx-navbar-right-search": "Search (narrow windows)",
	"class:btr-navbar-voice": "Voice status",
	"id:btr-navbar-voice": "Voice status",
}

/**
 * Our item behind a bar entry, marked on the entry or, for a sidebar link we
 * only hide, on the link inside it.
 */
const elementOf = (key: string, item?: HTMLElement) => {
	if (key.startsWith("btr:")) {
		return Navigation.elements[key.slice(4).replace(/#\d+$/, "")] ?? null
	}

	// Hidden by a rule on the page rather than a marker on the item.
	if (key === "link:/plus?referrals") {
		return Navigation.elements.sidebar_referral ?? null
	}

	const marker = item?.querySelector('[class*="btr-nav-node-"]')
	const name = marker && [...marker.classList].find((name) => name.startsWith("btr-nav-node-"))?.slice(13)
	return name ? (Navigation.elements[name] ?? null) : null
}

const elementName = (element: any) => String(element.label ?? element.name).replace(/^Show /, "")

const itemName = (key: string, item: HTMLElement) => {
	const element = elementOf(key, item)

	if (element?.label) {
		return elementName(element)
	}

	const known = ITEM_NAMES[key.replace(/#\d+$/, "")]

	if (known) {
		return known
	}

	// A slot Roblox fills with a different game each time.
	if (key.startsWith("link:/games")) {
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

const gripIcon = () =>
	html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
		<g fill="currentColor">
			<circle cx="9" cy="6" r="1.6" />
			<circle cx="15" cy="6" r="1.6" />
			<circle cx="9" cy="12" r="1.6" />
			<circle cx="15" cy="12" r="1.6" />
			<circle cx="9" cy="18" r="1.6" />
			<circle cx="15" cy="18" r="1.6" />
		</g>
	</svg>`

const eyeIcon = () =>
	html`<svg
		viewBox="0 0 24 24"
		width="20"
		height="20"
		aria-hidden="true"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
		<circle cx="12" cy="12" r="3" />
		<path class="btr-nav-eye-slash" d="M4 4l16 16" />
	</svg>`

/** An eye that shows or hides something, pressed while it is shown. */
const eyeButton = (name: string, shown: boolean, onToggle: () => void) => {
	const button = html<HTMLButtonElement>`<button type="button" class="btr-nav-eye"></button>`
	button.append(eyeIcon())
	button.setAttribute("aria-pressed", String(shown))
	button.setAttribute("aria-label", `${shown ? "Hide" : "Show"} ${name}`)
	button.title = shown ? "Shown, click to hide" : "Hidden, click to show"
	button.$on("click", onToggle)
	return button
}

/** The small switches an item of ours has, such as showing its count. */
const optionsOf = (element: any) => {
	const options = Object.values(element?.settings ?? {}) as any[]

	if (!options.length) {
		return null
	}

	const wrap = html`<div class="btr-nav-options"></div>`

	for (const option of options) {
		const chip = html<HTMLButtonElement>`<button type="button" class="btr-nav-option"></button>`
		chip.textContent = elementName(option)
		chip.setAttribute("aria-pressed", String(!!option.enabled))
		chip.disabled = !element.enabled
		chip.$on("click", () => option.setEnabled(!option.enabled))
		wrap.append(chip)
	}

	return wrap
}

const EASE = "cubic-bezier(0.2, 0, 0, 1)"

const rowsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".btr-nav-item[data-key]")]

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** Runs `change`, then slides each of `elements` from where it was to where it is now. */
const glide = (elements: HTMLElement[], change: () => void) => {
	const before = new Map(elements.map((element) => [element, element.getBoundingClientRect().top]))
	change()

	if (calm()) {
		return
	}

	for (const [element, top] of before) {
		const delta = top - element.getBoundingClientRect().top

		if (delta) {
			element.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
				duration: 200,
				easing: EASE,
			})
		}
	}
}

/**
 * Lets the list's items be dragged into a new order from their handles, which
 * also move them one place with the arrow keys. `save` gets the keys in the
 * new order.
 */
const sortable = (list: HTMLElement, save: (keys: string[]) => void, focusAfter: (key: string) => void) => {
	let dragging: HTMLElement | null = null
	const keys = () => [...list.children].map((item) => (item as HTMLElement).dataset.key!)

	list.addEventListener("pointerdown", (ev) => {
		const handle = (ev.target as Element).closest(".btr-nav-grip")
		const item = handle?.closest<HTMLElement>(".btr-nav-item")

		// Only the handle starts a drag, so the eye and options stay clickable.
		if (item) {
			item.draggable = true
		}
	})

	list.addEventListener("dragstart", (ev) => {
		dragging = (ev.target as Element).closest<HTMLElement>(".btr-nav-item")

		if (!dragging) {
			return
		}

		ev.dataTransfer?.setData("text/plain", dragging.dataset.key ?? "")

		if (ev.dataTransfer) {
			ev.dataTransfer.effectAllowed = "move"
		}

		dragging.classList.add("btr-nav-dragging")
	})

	list.addEventListener("dragover", (ev) => {
		if (!dragging) {
			return
		}

		ev.preventDefault()

		const over = (ev.target as Element).closest<HTMLElement>(".btr-nav-item")

		if (!over || over === dragging || over.parentElement !== list) {
			return
		}

		const box = over.getBoundingClientRect()
		const after = ev.clientY > box.top + box.height / 2
		const moved = dragging

		// Already there, as dragover fires all the time while it is held still.
		if ((after ? over.nextElementSibling : over.previousElementSibling) === moved) {
			return
		}

		glide([...list.children] as HTMLElement[], () => over[after ? "after" : "before"](moved))
	})

	list.addEventListener("drop", (ev) => ev.preventDefault())

	list.addEventListener("dragend", () => {
		if (!dragging) {
			return
		}

		dragging.classList.remove("btr-nav-dragging")
		dragging.draggable = false
		dragging = null
		save(keys())
	})

	list.addEventListener("keydown", (ev) => {
		const item = (ev.target as Element)
			.closest<HTMLElement>(".btr-nav-grip")
			?.closest<HTMLElement>(".btr-nav-item")

		if (!item || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) {
			return
		}

		ev.preventDefault()

		const sibling = ev.key === "ArrowUp" ? item.previousElementSibling : item.nextElementSibling

		if (sibling) {
			glide([...list.children] as HTMLElement[], () =>
				sibling[ev.key === "ArrowUp" ? "before" : "after"](item),
			)
			focusAfter(item.dataset.key!)
			save(keys())
		}
	})
}

export const addNavigationEditor = (modal: SettingsModalState) => {
	const host = modal.settingsDiv.$find(".btr-settings-nav-editor")

	if (!host) {
		return
	}

	// Saving redraws the lists, so the moved item's handle gets the focus back.
	let focusKey: string | null = null

	const listCard = (list: (typeof NAV_LISTS)[number], shown: Set<string>) => {
		const card = html`<section class="btr-nav-card">
			<header class="btr-nav-card-head">
				<h4 class="btr-nav-card-title"></h4>
			</header>
			<ol class="btr-nav-list"></ol>
		</section>`

		card.$req(".btr-nav-card-title").textContent = list.label
		const listElem = card.$req(".btr-nav-list")
		const items = currentItems(list.name)

		if (readOrder()[list.name]) {
			const reset = html<HTMLButtonElement>`<button type="button" class="btr-nav-reset">
				Reset order
			</button>`
			reset.$on("click", () => saveOrder(list.name, null))
			card.$req("header").append(reset)
		}

		if (!items?.length) {
			listElem.append(html`<li class="btr-nav-empty">Not on this page</li>`)
			return card
		}

		const hiddenHere = readHidden()[list.name] ?? []

		for (const { key, item } of items) {
			const element = elementOf(key, item)
			const name = itemName(key, item)
			const shownNow = element ? !!element.enabled : !hiddenHere.includes(key)

			if (element) {
				shown.add(element.name)
			}

			const row = html`<li class="btr-nav-item">
				<button type="button" class="btr-nav-grip"></button>
				<div class="btr-nav-text">
					<span class="btr-nav-name"></span>
				</div>
			</li>`

			row.dataset.key = key
			row.classList.toggle("btr-nav-item-off", !shownNow)

			const grip = row.$req<HTMLButtonElement>(".btr-nav-grip")
			grip.append(gripIcon())
			grip.setAttribute("aria-label", `Move ${name}: drag, or use the up and down arrow keys`)
			grip.title = "Drag to move"

			row.$req(".btr-nav-name").textContent = name

			const options = optionsOf(element)

			if (options) {
				row.$req(".btr-nav-text").append(options)
			}

			row.append(
				eyeButton(name, shownNow, () =>
					element
						? element.setEnabled(!element.enabled)
						: setHidden(list.name as NavListName, key, shownNow),
				),
			)

			listElem.append(row)
		}

		sortable(
			listElem,
			(keys) => saveOrder(list.name, keys),
			(key) => (focusKey = key),
		)

		return card
	}

	const render = () => {
		const shown = new Set<string>()
		const cards = NAV_LISTS.map((list) => listCard(list, shown))

		// Our items that are not in a bar on this page, such as the Plus banner.
		const others = (Object.values(Navigation.elements) as any[]).filter(
			(element) => !element.parent && !shown.has(element.name),
		)

		if (others.length) {
			const card = html`<section class="btr-nav-card">
				<header class="btr-nav-card-head">
					<h4 class="btr-nav-card-title">Not in a bar on this page</h4>
				</header>
				<ul class="btr-nav-list"></ul>
			</section>`

			for (const element of others) {
				const name = elementName(element)
				const row = html`<li class="btr-nav-item btr-nav-item-fixed">
					<div class="btr-nav-text"><span class="btr-nav-name"></span></div>
				</li>`

				row.$req(".btr-nav-name").textContent = name
				row.dataset.key = `element:${element.name}`
				row.classList.toggle("btr-nav-item-off", !element.enabled)

				const options = optionsOf(element)

				if (options) {
					row.$req(".btr-nav-text").append(options)
				}

				row.append(eyeButton(name, !!element.enabled, () => element.setEnabled(!element.enabled)))
				card.$req(".btr-nav-list").append(row)
			}

			cards.push(card)
		}

		// Where each row was and whether it was shown, so the new ones can slide
		// from there, and fade when they changed between shown and hidden.
		const before = new Map(
			(rowsIn(host) as HTMLElement[]).map((row) => [
				row.dataset.key,
				{ top: row.getBoundingClientRect().top, off: row.classList.contains("btr-nav-item-off") },
			]),
		)

		host.replaceChildren(...cards)

		if (!calm()) {
			for (const row of rowsIn(host) as HTMLElement[]) {
				const was = before.get(row.dataset.key)

				if (!was) {
					continue
				}

				const delta = was.top - row.getBoundingClientRect().top

				if (delta) {
					row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
						duration: 200,
						easing: EASE,
					})
				}

				if (was.off !== row.classList.contains("btr-nav-item-off")) {
					row.$find(".btr-nav-name")?.animate([{ opacity: 0.2 }, { opacity: 1 }], {
						duration: 220,
						easing: EASE,
					})
				}
			}
		}

		if (focusKey) {
			;(
				host.$find(
					`.btr-nav-item[data-key="${CSS.escape(focusKey)}"] .btr-nav-grip`,
				) as HTMLElement | null
			)?.focus()
			focusKey = null
		}
	}

	SETTINGS.onChange("navigation.order", render)
	SETTINGS.onChange("navigation.hiddenItems", render)
	SETTINGS.onChange("navigation.elements", render)
	render()

	// The panel can be built, or opened again after a reload, before Roblox
	// draws its bars, so the lists are read again whenever the page is shown
	// and whenever a bar turns up or changes while it is.
	const page = host.closest(".btr-settings-page")
	const selected = () => !!page?.classList.contains("selected")
	let pending: ReturnType<typeof setTimeout> | undefined

	const soon = () => {
		clearTimeout(pending)
		pending = setTimeout(() => {
			// Not under a drag, which a redraw would cut short.
			if (selected() && !host.querySelector(".btr-nav-dragging")) {
				render()
			}
		}, 150)
	}

	for (const { selector } of NAV_LISTS) {
		document.$watchAll(selector, (container: Element) => {
			soon()
			new MutationObserver(soon).observe(container, { childList: true })
		})
	}

	if (page) {
		new MutationObserver(() => {
			if (selected()) {
				host.classList.add("btr-nav-entering")
				render()
				setTimeout(() => host.classList.remove("btr-nav-entering"), 500)
			}
		}).observe(page, { attributeFilter: ["class"] })
	}
}
