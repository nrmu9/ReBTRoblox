import { onDomChanged } from "@/core/dom"
import { html } from "@/core/html"
import { contentScript, injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"
import { initContentButton, initDownloadButton, initExplorer } from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"

pageInit.create_store = () => {
	if (!SETTINGS.get("create.enabled")) {
		return
	}

	const addRipple = (elem: any, position?: any) => {
		elem?.$on("mousedown", (event: MouseEvent) => {
			const ripple = html`<div class="btr-replica-ripple"></div>`
			elem.append(ripple)
			setTimeout(() => ripple.remove(), 1e3)

			if (position) {
				const rect = elem.getBoundingClientRect()
				ripple.style.left = `${event.clientX - rect.x}px`
				ripple.style.top = `${event.clientY - rect.y}px`
			}
		})
	}

	document.$on("mouseover", ".btr-download-popover li", (event: Event) => {
		const target = event.currentTarget as HTMLElement

		if (!target.dataset.btrAddedRipple) {
			target.dataset.btrAddedRipple = "true"
			addRipple(target, true)
		}
	})

	class AssetDetailsPage {
		[key: string]: any

		constructor(assetId: number) {
			this.assetId = assetId
			this.buttons = {}

			RobloxApi.economy.getAssetDetails(assetId).then((json: any) => {
				if (this.assetId !== assetId) {
					return
				}
				this.assetTypeId = json.AssetTypeId

				this.updateButtons()
			})

			this.listener = onDomChanged(() => {
				this.updateAnchor()
			})

			this.updateAnchor()
		}

		addButton(name: string, elem: HTMLElement) {
			if (!elem) {
				return
			}

			this.buttons[name] = elem
			addRipple(elem.$find(">a"))

			this.updateButtons()
		}

		updateButtons() {
			if (!this.assetTypeId) {
				return
			}

			if (!this.contentPromise) {
				this.contentPromise = initContentButton(this.assetId, this.assetTypeId)
				this.contentPromise.then((elem: HTMLElement) => this.addButton("content", elem))
			}

			if (!this.downloadPromise) {
				this.downloadPromise = initDownloadButton(this.assetId, this.assetTypeId)
				this.downloadPromise.then((elem: HTMLElement) => this.addButton("download", elem))
			}

			if (!this.explorerPromise) {
				this.explorerPromise = initExplorer(this.assetId, this.assetTypeId)
				this.explorerPromise.then((elem: HTMLElement) => this.addButton("explorer", elem))
			}

			this.anchor?.prepend(
				...[this.buttons.content, this.buttons.download, this.buttons.explorer].filter((x) => x),
			)
		}

		updateAnchor() {
			const anchor =
				document.querySelector(
					`button[data-testid="getAsset"],button[data-testid="PLAYWRIGHT_getAsset"]`,
				)?.parentNode || null
			if (anchor === this.anchor) {
				return
			}

			this.anchor = anchor
			this.updateButtons()
		}

		close() {
			this.listener?.disconnect()

			this.assetId = null
			this.assetTypeId = null

			this.listener = null
			this.anchor = null

			this.explorerPromise?.then((btn: HTMLElement) => btn?.remove())
			this.downloadPromise?.then((btn: HTMLElement) => btn?.remove())
			this.contentPromise?.then((btn: HTMLElement) => btn?.remove())

			this.explorerPromise = null
			this.downloadPromise = null
			this.contentPromise = null
		}
	}

	//

	let currPageParams: any
	let currPageObj: any
	let currPage: any

	const stateChanged = () => {
		let nextPageParams
		let nextPage

		const assetId = Number.parseInt(
			location.pathname.match(/\/(?:marketplace|store)\/asset\/(\d+)/i)?.[1] ?? "",
			10,
		)
		if (assetId) {
			nextPage = AssetDetailsPage
			nextPageParams = [assetId]
		}

		//

		if (currPage) {
			if (nextPage === currPage && JSON.stringify(nextPageParams) === JSON.stringify(currPageParams)) {
				return // no change in page
			}

			currPageObj?.close?.()
			currPageParams = null
			currPage = null
		}

		if (nextPage) {
			currPageParams = nextPageParams
			currPageObj = new nextPage(...currPageParams)
			currPage = nextPage
		}
	}

	document.$watch(">body", () => {
		stateChanged()
		window.addEventListener("popstate", stateChanged)

		injectScript.listen("stateChange", stateChanged)
		injectScript.call("marketplacePageChanged", () => {
			hijackFunction(history, "pushState", (target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)
				contentScript.send("stateChange")
				return result
			})

			hijackFunction(history, "replaceState", (target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)
				contentScript.send("stateChange")
				return result
			})
		})
	})
}
