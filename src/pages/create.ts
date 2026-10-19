import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { Navigation } from "@/feat/navigation"
import { SETTINGS } from "@/feat/settings"
import { SettingsModal, watchSettingsMenu } from "@/feat/settingsModal"
import { loggedInUser, loggedInUserPromise } from "@/pages/common"
import { setLoggedInUser } from "@/pages/common"

pageInit.create = () => {
	// Init global features

	Navigation.init()
	SettingsModal.enable()
	// Reachable even with the create features off.
	watchSettingsMenu(`a[role=menuitem][href^="/settings"]`)

	//

	injectScript.call("hijackAuth")

	injectScript.listen(
		"onFirstAuth",
		(json: any) => {
			const userId = json?.id ?? -1

			setLoggedInUser(Number.isSafeInteger(userId) ? userId : -1)
			loggedInUserPromise.$resolve(loggedInUser)
		},
		{ once: true },
	)

	//

	if (!SETTINGS.get("create.enabled")) {
		return
	}

	injectScript.call("webpackHook")
}
