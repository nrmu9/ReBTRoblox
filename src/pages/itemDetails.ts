import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import type { ItemPreviewer } from "@/rbx/Preview"
import { pageInit } from "@/core/page"
import { loadOptionalFeature } from "@/feat/loadFeature"
import { RobuxToCash } from "@/feat/robuxToCash"
import { SETTINGS } from "@/feat/settings"
import {
	formatNumber,
	initContentButton,
	initDownloadButton,
	initExplorer,
	initPreview,
	onPageLoad,
	onPageReset,
} from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"
import { query, queryAll } from "@/core/query"

pageInit.itemdetails = () => {
	if (SETTINGS.get("general.hoverPreview")) {
		loadOptionalFeature("previewer").then(({ HoverPreview }) => {
			HoverPreview.register(".item-card", ".item-card-thumb-container")
		})
	}

	if (!SETTINGS.get("itemdetails.enabled")) {
		return
	}

	injectScript.call("itemdetails")

	onPageReset(() => {})

	onPageLoad((category, assetIdString) => {
		const assetId = Number.parseInt(assetIdString, 10)

		document
			.$watch("#content")
			.$then()
			.$watch(">#item-details-container, >#item-container", (container: HTMLElement) => {
				const isReactItemDetails = container.id === "item-details-container"

				container.$watch(
					"#type-content, .item-type-field-container .field-content",
					(typeField: any) => {
						const isNewStyle = !typeField.classList.contains("field-content")

						const createRow = (label: string, content: HTMLElement | string) => {
							return isReactItemDetails
								? html` <div class="clearfix item-info-row-container" style="display:none">
										<div
											class="font-header-1 text-subheader text-label text-overflow row-label"
										>
											${label}
										</div>
										<span class="btr-row-value font-body text">${content}</span>
									</div>`
								: isNewStyle
									? html` <div class="clearfix item-field-container" style="display:none">
											<div
												class="font-header-1 text-subheader text-label text-overflow field-label"
											>
												${label}
											</div>
											<span class="btr-row-value font-body text">${content}</span>
										</div>`
									: html` <div class="clearfix item-field-container" style="display:none">
											<div class="text-label text-overflow field-label">${label}</div>
											<span class="btr-row-value field-content">${content}</span>
										</div>`
						}

						if (SETTINGS.get("itemdetails.showSales") && category !== "bundles") {
							const salesContainer = createRow("Sales", "")

							typeField.parentNode.after(salesContainer)

							const show = (sales?: any) => {
								if (typeof sales === "number") {
									salesContainer.$req(".btr-row-value").textContent = formatNumber(sales)
								}
								salesContainer.style.display = ""
							}

							const hide = () => {
								salesContainer.style.display = "none"
							}

							let canConfigure = false

							document.$watch("#configure-item", () => {
								canConfigure = true
								show()
							})

							if (category === "game-pass") {
								RobloxApi.gamepasses.getGamepassProductInfo(assetId).then((data: any) => {
									const sales = data?.Sales

									if (Number.isSafeInteger(sales) && (canConfigure || sales > 0)) {
										show(sales)
									} else {
										hide()
									}
								})
							} else if (category === "badges") {
								salesContainer.$req(".text-label").textContent = "Awarded"
								show()

								RobloxApi.badges.getBadgeDetails(assetId).then((data: any) => {
									const numAwarded = data?.statistics?.awardedCount

									if (Number.isSafeInteger(numAwarded)) {
										show(numAwarded)
									} else {
										hide()
									}
								})
							} else {
								RobloxApi.economy.getAssetDetails(assetId).then((data: any) => {
									const sales = data?.Sales

									if (Number.isSafeInteger(sales) && (canConfigure || sales > 0)) {
										show(sales)
									} else {
										hide()
									}
								})
							}
						}

						if (SETTINGS.get("itemdetails.showCreatedAndUpdated") && category !== "bundles") {
							// remove old created/updated label
							if (isReactItemDetails) {
								const oldLabel = Array.from(
									queryAll("#item-details .wait-for-i18n-format-render"),
								).find((x: any) => !isNaN(Date.parse(x.textContent)))

								if (oldLabel) {
									oldLabel.parentElement?.remove()
								}
							} else {
								const oldLabel = query("#item-details .date-time-i18n")

								if (oldLabel) {
									oldLabel.closest(".field-content")?.parentElement?.remove()
								}
							}

							const createdContainer = createRow("Created", "")
							const updatedContainer = createRow("Updated", "")

							typeField.parentNode.after(createdContainer, updatedContainer)

							const show = (created?: any, updated?: any) => {
								if (created) {
									createdContainer.$req(".btr-row-value").textContent = new Date(
										created,
									).$format("MMM DD, YYYY h:mm:ss A")
								}
								if (updated) {
									updatedContainer.$req(".btr-row-value").textContent = new Date(
										updated,
									).$format("MMM DD, YYYY h:mm:ss A")
								}
								createdContainer.style.display = ""
								updatedContainer.style.display = ""
							}

							show()

							if (category === "game-pass") {
								RobloxApi.gamepasses.getGamepassProductInfo(assetId).then((data: any) => {
									show(data.Created, data.Updated)
								})
							} else if (category === "badges") {
								RobloxApi.badges.getBadgeDetails(assetId).then((data: any) => {
									show(data.created, data.updated)
								})
							} else {
								RobloxApi.economy.getAssetDetails(assetId).then((data: any) => {
									show(data.Created, data.Updated)
								})
							}
						}
					},
				)

				if (isReactItemDetails) {
					// modern item details page

					container.$watch(".btr-buttons", (buttons: HTMLElement) => {
						const assetId = +buttons.dataset.btrAssetId!
						const itemType = buttons.dataset.btrItemType

						const isBundle = itemType === "Bundle"
						const assetTypeId = isBundle ? null : +buttons.dataset.btrAssetTypeId!

						// setVisible(false) detaches the previewer and setVisible(true) puts
						// it back, so it only has to be built once and the setting can be
						// flipped either way without a reload.
						let previewer: ItemPreviewer | null = null

						const applyPreviewer = () => {
							if (!SETTINGS.get("itemdetails.itemPreviewer")) {
								previewer?.setVisible(false)
								return
							}

							if (previewer) {
								previewer.setVisible(true)
								return
							}

							void initPreview(assetId, assetTypeId, isBundle).then((preview) => {
								if (!preview) {
									return
								} // preview didnt load
								if (!document.contains(buttons)) {
									return
								} // already changed page
								if (!SETTINGS.get("itemdetails.itemPreviewer")) {
									return
								} // switched back off while it was loading

								const parent = document.querySelector(
									".item-thumbnail-container, #item-thumbnail-container-frontend",
								)?.parentElement

								if (!parent) {
									return
								}

								previewer = preview
								preview.setParent(parent)
							})
						}

						applyPreviewer()
						SETTINGS.onChange("itemdetails.itemPreviewer", applyPreviewer)

						// Each button builds itself and returns nothing when its setting is
						// off, so switching one back on is just running it again, and
						// switching it off is removing what it left behind. That is what
						// lets these apply without a reload.
						const attachButton = (
							init: (id: any, typeId: any, bundle: any) => Promise<any>,
							settingPath: string,
							selector: string,
						) => {
							let attached: HTMLElement | null = null

							const apply = () => {
								if (!SETTINGS.get(settingPath)) {
									attached?.remove()
									attached = null
									buttons.$find(selector)?.remove()
									return
								}

								if (attached?.isConnected) {
									return
								}

								void init(assetId, assetTypeId, isBundle).then((btnCont) => {
									// The setting may have been turned back off while this was
									// still building.
									if (!btnCont || !SETTINGS.get(settingPath)) {
										return
									}

									attached = btnCont
									buttons.append(btnCont)
								})
							}

							apply()
							SETTINGS.onChange(settingPath, apply)
						}

						attachButton(
							initExplorer,
							"itemdetails.explorerButton",
							".btr-explorer-button-container",
						)
						attachButton(
							initDownloadButton,
							"itemdetails.downloadButton",
							".btr-download-button-container",
						)
						attachButton(
							initContentButton,
							"itemdetails.contentButton",
							".btr-content-button-container",
						)
					})
				} else {
					// legacy item details page (used for badges/gamepasses)

					container.$watch(".text-robux-lg", (elem: HTMLElement) => {
						const originalText = elem.textContent
						const robux = parseInt(originalText.replace(/\D/g, ""), 10)

						if (Number.isSafeInteger(robux)) {
							const cash = RobuxToCash.convert(robux)

							elem.append(html`<span class="btr-robuxToCash-big"> (${cash})</span>`)
						}
					})
				}
			})
	})
}
