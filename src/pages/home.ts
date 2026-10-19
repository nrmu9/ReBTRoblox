import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"

pageInit.home = () => {
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
