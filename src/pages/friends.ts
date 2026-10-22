import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"
import { addUnfriendButtons } from "@/feat/quickRemove"
import { loggedInUserPromise } from "@/pages/common"

pageInit.friends = () => {
	if (SETTINGS.get("general.quickRemove")) {
		void loggedInUserPromise.then((userId) => userId > 0 && addUnfriendButtons(userId))
	}
}
