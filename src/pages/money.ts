import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { RobuxToCash } from "@/feat/robuxToCash"

pageInit.money = () => {
	if (RobuxToCash.isEnabled()) {
		injectScript.call("money")
	}
}
