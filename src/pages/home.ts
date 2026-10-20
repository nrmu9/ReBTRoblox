import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { btrLocalStorage } from "@/core/storage"
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
