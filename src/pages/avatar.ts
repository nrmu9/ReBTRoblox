import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"
import { RobloxApi } from "@/rbx/RobloxApi"

pageInit.avatar = () => {
	if (!SETTINGS.get("avatar.enabled")) {
		return
	}

	injectScript.call("avatar")

	if (SETTINGS.get("avatar.fullRangeBodyColors")) {
		injectScript.call("fullRangeBodyColors")

		document.$watch("#bodyColors", async (cont: HTMLElement) => {
			const bodyColor3s = (await RobloxApi.avatar.getCurrentAvatar()).bodyColor3s

			const selector = html`
			<div class=btr-color-selector>
				<input type=color class=btr-color-head></input>
				<input type=color class=btr-color-torso></input>
				<input type=color class=btr-color-leftArm></input>
				<input type=color class=btr-color-rightArm></input>
				<input type=color class=btr-color-leftLeg></input>
				<input type=color class=btr-color-rightLeg></input>
			</div>`

			const inputs: Record<string, HTMLInputElement> = {}
			let debounce = 0

			const updateBodyColors = async () => {
				const deb = ++debounce
				const newColor3s = (await RobloxApi.avatar.getCurrentAvatar()).bodyColor3s

				if (debounce === deb) {
					for (const [name, oldColor] of Object.entries(bodyColor3s) as [string, any][]) {
						const newColor = newColor3s[name]

						if (newColor.toLowerCase() !== oldColor.toLowerCase()) {
							bodyColor3s[name] = newColor
							inputs[name.slice(0, -6)].value = `#${newColor}`
						}
					}
				}
			}
			const setBodyColors = async () => {
				const json = await RobloxApi.avatar.setBodyColors(bodyColor3s)

				if (json && !json.errors) {
					injectScript.send("forceRefreshThumbnail")
				} else {
					injectScript.send("skinColorError")
				}
			}

			for (const input of selector.$findAll<HTMLInputElement>("input")) {
				const name = input.className.slice(10)

				input.value = `#${bodyColor3s[`${name}Color3`]}`
				inputs[name] = input

				input.$on("change", () => {
					const color = input.value.slice(1)

					if (bodyColor3s[`${name}Color3`].toLowerCase() !== color.toLowerCase()) {
						bodyColor3s[`${name}Color3`] = color
						setBodyColors()
					}
				})
			}

			injectScript.listen("updateBodyColors", updateBodyColors)

			cont.$req(".section-content").prepend(
				selector,
				html`<hr style="margin-top:40px;margin-bottom:30px;" />`,
			)
		})
	}
}
