import { onDomChanged, setImmediate } from "@/core/dom"
import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { delay, ready } from "@/core/util"
import { SETTINGS } from "@/feat/settings"
import { modifyAngularTemplate, loadPreviewer } from "@/pages/common"
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

						const content = script.textContent ?? ""

						if (
							content.includes("Roblox.DeveloperConsoleWarning.showWarning()") ||
							content.match(/top.location\s*=\s*self.location/)
						) {
							script.textContent = ""
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
		loadPreviewer().then(({ HoverPreview }) => {
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
			.$on("click", ".btr-it-remove", async () => {
				if (isRemoving) {
					return
				}

				const checked = queryAll<HTMLInputElement>(".btr-it-box:checked")
				if (!checked.length) {
					return
				}

				isRemoving = true

				const button = query<HTMLElement>(".btr-it-remove")
				const label = button?.textContent ?? "Remove"
				const items: Array<{
					card: HTMLElement
					box: HTMLInputElement
					isBadge: boolean
					id: number
				}> = []

				for (const box of checked) {
					const card = box.closest<HTMLElement>(".item-card")
					const matches = card
						?.$find<HTMLAnchorElement>(".item-card-link")
						// Creator Store items link to store/asset now.
						?.href.match(/(?:\/(catalog|library|game-pass|badges|store\/asset)\/|[?&]id=)(\d+)/)

					if (card && matches && Number.isSafeInteger(+matches[2])) {
						items.push({
							card,
							box,
							isBadge: matches[1]?.toLowerCase() === "badges",
							id: +matches[2],
						})
					}
				}

				// One at a time, each waiting on its answer, so Roblox is not asked
				// faster than it allows. A 429 is waited out and tried again. A card
				// goes only once its item is gone, and whatever happens, the run ends.
				const removeOne = async (item: (typeof items)[number]) => {
					try {
						if (!item.isBadge) {
							const data = await RobloxApi.economy.getAssetDetails(item.id)

							if (!validAssetTypes.includes(data?.AssetTypeId)) {
								return "skipped"
							}
						}

						for (let attempt = 0; attempt < 4; attempt++) {
							const result = item.isBadge
								? await RobloxApi.badges.deleteBadge(item.id)
								: await RobloxApi.www.deleteAssetFromInventory(item.id)

							if (result?.ok) {
								return "removed"
							}

							if (result?.status !== 429) {
								return "failed"
							}

							await delay((result.retryAfter ?? 2 ** (attempt + 1)) * 1000)
						}
					} catch (err) {
						console.error("[btr] could not remove", item.id, err)
					}

					return "failed"
				}

				let removed = 0
				let failed = 0

				for (const [index, item] of items.entries()) {
					if (button) {
						button.textContent = `Removing ${index + 1}/${items.length}`
					}

					const outcome = await removeOne(item)
					item.card.classList.toggle("btr-it-failed", outcome === "failed")

					if (outcome === "removed") {
						item.card.remove()
						removed++
						await delay(300)
					} else if (outcome === "skipped") {
						// Not a type the inventory tools handle.
						item.box.checked = false
					} else {
						failed++
					}
				}

				isRemoving = false

				if (button) {
					button.textContent = failed ? `Couldn't remove ${failed}` : label

					if (failed) {
						setTimeout(() => (button.textContent = label), 4000)
					}
				}

				updateButtons()

				if (removed) {
					injectScript.call("refreshInventory")
				}
			})
	}
}
