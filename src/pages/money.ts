import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { RobuxToCash } from "@/feat/robuxtocash"
import { pageInit } from "@/pages/common"

pageInit.money = () => {
	if(RobuxToCash.isEnabled()) {
		injectScript.call("money", () => {
			reactHook.inject(".balance-label.icon-robux-container", elem => {
				const list = elem[0].props.children[0]?.props.children
				
				if(Array.isArray(list)) {
					const robux = parseInt(list.at(-1).replace(/\D/g, ""), 10)
					
					if(Number.isSafeInteger(robux)) {
						const cash = RobuxToCash.convert(robux)
						
						list.push(reactHook.createElement("span", {
							className: "btr-robuxToCash",
							children: ` (${cash})`
						}))
					}
				}
			})
		})
	}
}