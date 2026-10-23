import { injectScript } from "@/core/messaging"
import { isKey, isRecord, isText } from "@/core/pageInput"
import { pageInit } from "@/core/page"
import { btrLocalStorage } from "@/core/storage"
import { html } from "@/core/html"
import { expectFound } from "@/core/health"
import { SETTINGS } from "@/feat/settings"

/** The Home rows seen so far, by topic id, for the settings to list. */
export const HOME_ROWS_KEY = "homeRows"

/** Home's other sections seen so far, by kind, for the settings to list. */
export const HOME_SECTIONS_KEY = "homeSections"

// Home's sections beside the game rows: the friends strip, and the items
// Roblox sends to show in its feed, such as event banners. Each kind is
// remembered the first time it shows, so new kinds can be hidden too.
const SECTIONS = ".friend-carousel-container, .sdui-feed-item-container"

/** What kind a section is, the same on every visit: Friends, or a feed item by its type. */
const sectionKey = (section: Element) => {
	if (section.classList.contains("friend-carousel-container")) {
		return "friends"
	}

	const type = expectFound("a Home feed item's kind", section.querySelector("[data-testid]"))?.getAttribute(
		"data-testid",
	)
	return type ? `feed:${type}` : null
}

export const sectionLabel = (key: string) =>
	key === "friends"
		? "Friends"
		: key === "feed:hero-unit"
			? "Banners"
			: `${key
					.slice(5)
					.replace(/-/g, " ")
					.replace(/^\w/, (letter) => letter.toUpperCase())}`

const hiddenSections = (): string[] => {
	try {
		const list = JSON.parse(SETTINGS.get("home.hiddenSections") || "[]")
		return Array.isArray(list) ? list.map(String) : []
	} catch {
		return []
	}
}

/**
 * Hides or shows a section, and remembers its kind with an example of what it
 * showed. False until both are known: a feed item fills in its title last.
 */
const placeSection = (section: HTMLElement) => {
	const key = sectionKey(section)

	if (!key) {
		return false
	}

	section.classList.toggle("btr-home-section-hidden", hiddenSections().includes(key))

	const known = btrLocalStorage.getItem<Record<string, { example?: string }>>(HOME_SECTIONS_KEY) ?? {}
	// The friends strip is always the friends strip, so it needs no example.
	const example =
		key === "friends"
			? undefined
			: expectFound("a Home feed item's title", section.querySelector("[class*=heroUnitTitle], h2, h3"))
					?.textContent?.trim()
					.slice(0, 60)

	if (!known[key] || (example && known[key].example !== example)) {
		known[key] = example ? { example } : {}
		btrLocalStorage.setItem(HOME_SECTIONS_KEY, known)
	}

	return key === "friends" || !!example
}

pageInit.home = () => {
	injectScript.listen("homeRows", (rows: Array<{ id: string; title?: string; subtitle?: string }>) => {
		const known = btrLocalStorage.getItem<Record<string, any>>(HOME_ROWS_KEY) ?? {}
		let changed = false

		for (const row of Array.isArray(rows) ? rows.slice(0, 200) : []) {
			if (!isRecord(row) || !isKey(row.id) || !isText(row.title) || !isText(row.subtitle ?? "")) {
				continue
			}

			if (
				row?.id &&
				row.title &&
				(known[row.id]?.title !== row.title || known[row.id]?.subtitle !== row.subtitle)
			) {
				known[row.id] = { title: row.title, subtitle: row.subtitle }
				changed = true
			}
		}

		if (changed) {
			btrLocalStorage.setItem(HOME_ROWS_KEY, known)
		}
	})

	const sections = new Set<HTMLElement>()

	document.$watchAll(SECTIONS, (section: HTMLElement) => {
		sections.add(section)

		// A feed item can arrive empty, and only says what it is once filled in.
		// Until then it is placed again on every change, so hiding applies as
		// soon as its kind shows.
		if (!placeSection(section)) {
			const observer = new MutationObserver(() => {
				if (placeSection(section)) {
					observer.disconnect()
				}
			})

			observer.observe(section, { childList: true, subtree: true })
		}
	})

	SETTINGS.onChange("home.hiddenSections", () => {
		for (const section of sections) {
			if (section.isConnected) {
				placeSection(section)
			} else {
				sections.delete(section)
			}
		}
	})

	// A quiet way back to rows you hid, at the bottom of Home.
	let hidden: unknown[] = []

	try {
		hidden = JSON.parse(SETTINGS.get("home.hiddenRows") || "[]")
	} catch {}

	if (Array.isArray(hidden) && hidden.length) {
		document.$watch(".game-home-page-container", (container: HTMLElement) => {
			const note = html`<div class="btr-hidden-rows text-label">
				${hidden.length === 1 ? "1 row hidden" : `${hidden.length} rows hidden`} ·
				<button type="button" class="btr-hidden-rows-manage">Manage</button>
			</div>`

			note.$req("button").$on("click", () => {
				document.dispatchEvent(new CustomEvent("btr-open-settings", { detail: "home" }))
			})

			container.append(note)
		})
	}

	if (SETTINGS.get("home.favoritesAtTop")) {
		injectScript.call("favoritesAtTop")
	}

	if (SETTINGS.get("home.showRecommendationPlayerCount")) {
		injectScript.call("showRecommendationPlayerCount")
	}

	if (SETTINGS.get("home.instantGameHoverAction")) {
		injectScript.call("instantGameHoverAction")
	}
}
