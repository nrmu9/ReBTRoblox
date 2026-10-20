import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { btrLocalStorage } from "@/core/storage"
import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"

/** The Home rows seen so far, by topic id, for the settings to list. */
export const HOME_ROWS_KEY = "homeRows"

pageInit.home = () => {
	injectScript.listen("homeRows", (rows: Array<{ id: string; title?: string; subtitle?: string }>) => {
		const known = btrLocalStorage.getItem<Record<string, any>>(HOME_ROWS_KEY) ?? {}
		let changed = false

		for (const row of rows ?? []) {
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
