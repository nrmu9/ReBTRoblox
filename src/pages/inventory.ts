import { onDomChanged, setImmediate } from "@/core/dom"
import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { ready } from "@/core/util"
import { loadOptionalFeature } from "@/feat/loadFeature"
import { SETTINGS } from "@/feat/settings"
import { modifyAngularTemplate } from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"
import { query, queryAll } from "@/core/query"

pageInit.inventory = () => {
	if (window.parent !== window) {
		const iframe = window.top!.document.querySelector(
			"#btr-injected-inventory",
		) as HTMLIFrameElement | null

		if (iframe?.contentWindow === window) {
			// This frame may not navigate the tab, which is what keeps the page's
			// frame buster from taking it over, so a link here asks the profile to
			// follow it instead. Bubbling, so a link the page handles itself and
			// cancels is left alone, and a modified click still opens a new tab.
			document.addEventListener("click", (ev: MouseEvent) => {
				if (ev.defaultPrevented || ev.button !== 0) {
					return
				}
				if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) {
					return
				}

				const link = (ev.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]")
				if (!link || (link.target && link.target !== "_self" && link.target !== "_top")) {
					return
				}

				const url = new URL(link.href, location.href)

				// Category tabs and the like change the hash and stay in the frame.
				if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) {
					return
				}

				ev.preventDefault()
				window.parent.postMessage({ btrInventoryNavigate: url.href }, location.origin)
			})

			document
				.$watch("body", (body: HTMLElement) => {
					body.classList.add("btr-embed")

					let requested = false
					let lastHeight: string | undefined

					const updateHeight = () => {
						if (!requested) {
							requested = true

							setImmediate(() => {
								const height = `${body.clientHeight}px`
								if (lastHeight !== height) {
									lastHeight = iframe!.style.height = height
								}

								requested = false
							})
						}
					}

					ready(() => {
						updateHeight()
						onDomChanged(updateHeight)
					})
				})
				.$then()
				.$watch("#chat-container", (chat: any) => chat.remove())

			const scripts = document.getElementsByTagName("script")
			const checked = new WeakSet()

			const checkForScripts = () => {
				for (let i = scripts.length; i--;) {
					const script = scripts[i]

					if (!checked.has(script)) {
						checked.add(script)

						if (script.src) {
							continue
						}

						const content = script.innerHTML

						if (
							content.includes("Roblox.DeveloperConsoleWarning.showWarning()") ||
							content.match(/top.location\s*=\s*self.location/)
						) {
							script.innerHTML = ""
							script.remove()
						}
					}
				}
			}

			const listener = onDomChanged(checkForScripts)
			checkForScripts()

			ready(() => {
				listener.disconnect()
				checkForScripts()
			})
		}
	}

	if (SETTINGS.get("general.hoverPreview")) {
		loadOptionalFeature("previewer").then(({ HoverPreview }) => {
			HoverPreview.register(".item-card", ".item-card-thumb-container")
		})
	}

	if (!SETTINGS.get("inventory.enabled")) {
		return
	}

	if (SETTINGS.get("inventory.inventoryTools")) {
		const validAssetTypes = [10, 13, 40, 3, 24, 2, 11, 12, 21]

		modifyAngularTemplate("assets-explorer", (template) => {
			const visibility = `$ctrl.staticData.isOwnPage && (${validAssetTypes
				.map((x) => `$ctrl.currentData.AssetTypeId === ${x}`)
				.join(" || ")})`

			for (const title of template.$findAll(".assets-explorer-title")) {
				title.after(
					html` <div class="header-content" ng-show="${visibility}">
						<a
							class="btn btn-secondary-sm btr-it-btn btr-it-remove disabled"
							style="float:right;margin-left:10px;"
							>Remove</a
						>
					</div>`,
				)
			}

			for (const cont of template.$findAll("#assetsItems .item-card-container")) {
				cont.append(
					html` <span
						class="checkbox btr-it-checkbox"
						ng-if="item.Creator.Id !== 1 && ${visibility}"
					>
						<input
							type="checkbox"
							id="btr-it-box{{$index}}"
							class="btr-it-box"
							data-index="{{$index}}"
						/>
						<label
							for="btr-it-box{{$index}}"
							style="position:absolute;left:6px;top:6px;width:auto;"
						></label>
					</span>`,
				)
			}
		})

		let isRemoving = false
		let lastPressed: any = null

		const updateButtons = function () {
			query(".btr-it-btn")?.classList.toggle("disabled", !query(".btr-it-box:checked"))
		}

		injectScript.listen("inventoryUpdateEnd", updateButtons)

		injectScript.call("inventoryTools")

		document
			.$on("change", ".btr-it-box", (_e) => {
				updateButtons()
			})
			.$on<MouseEvent>("click", ".btr-it-checkbox", (e) => {
				const checkbox = e.currentTarget.$req<HTMLInputElement>(".btr-it-box")
				const id = +checkbox.dataset.index!

				if (e.shiftKey && lastPressed != null && id !== lastPressed) {
					const from = Math.min(id, lastPressed)
					const to = Math.max(id, lastPressed)
					const value = !checkbox.checked

					for (let i = from; i <= to; i++) {
						const box = query<HTMLInputElement>(`#btr-it-box${i}`)
						if (box) {
							box.checked = value
						}
					}

					updateButtons()
					e.preventDefault()
				}

				lastPressed = id
			})
			.$on("click", ".item-card-link", () => {
				if (query(".btr-it-box:checked") != null) {
					return false
				}
			})
			.$on("click", ".btr-it-remove", () => {
				if (isRemoving) {
					return
				}

				const checked = queryAll(".btr-it-box:checked")
				if (!checked.length) {
					return
				}

				isRemoving = true
				const items: any[] = []
				for (let i = 0; i < checked.length; i++) {
					const self: any = checked[i].closest(".item-card")
					const matches = self
						.$find(".item-card-link")
						.href.match(/(?:\/(catalog|library|game-pass|badges)\/|[?&]id=)(\d+)/)

					if (matches && Number.isSafeInteger(+matches[2])) {
						items.push({
							obj: self,
							assetType: matches[1].toLowerCase(),
							assetId: matches[2],
						})
					}
				}

				let itemsLeft = items.length

				function removeItem(index: number) {
					const item = items[index]
					if (!item) {
						return
					}

					const done = () => {
						item.obj.remove()

						if (--itemsLeft === 0) {
							isRemoving = false

							injectScript.call("refreshInventory")
						}
					}

					if (item.assetType === "badges") {
						RobloxApi.badges.deleteBadge(item.assetId).then(done)
					} else {
						RobloxApi.economy.getAssetDetails(item.assetId).then((data: any) => {
							if (validAssetTypes.indexOf(data.AssetTypeId) === -1) {
								return console.log("Bad assetType", data)
							}

							RobloxApi.www.deleteAssetFromInventory(item.assetId).then(done)
						})
					}

					setTimeout(removeItem, 250, index + 1)
				}

				removeItem(0)
			})
	}
}
