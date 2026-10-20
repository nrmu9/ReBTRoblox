import { IS_DEV_MODE } from "@/entries/inject/state"
import { contentScript } from "@/entries/inject/messaging"
import { angularHook } from "@/entries/inject/angular"
import { reactHook } from "@/entries/inject/react"

// Injected functions for catalog items, item details and the inventory.

export const catalogFunctions: Record<string, (...args: any[]) => any> = {
	showOwnedAssets: () => {
		const ownedAssets: Record<string, any> = {}

		contentScript.listen("updateOwnedAssets", (changes) => {
			for (const [assetId, isOwned] of Object.entries(changes) as [string, any][]) {
				ownedAssets[+assetId]?.set(isOwned)
			}
		})

		reactHook.hijackConstructor(
			// ItemCard
			(props: any) => "unitsAvailableForConsumption" in props && "id" in props,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]
				const result = target.apply(thisArg, args)

				if (props.type === "Asset" && props.id) {
					let state = ownedAssets[props.id]

					if (!state) {
						state = reactHook.createGlobalState(false)
						ownedAssets[props.id] = state

						contentScript.send("checkOwnedAsset", props.id)
					}

					const owned = reactHook.useGlobalState(state)

					if (owned) {
						result.props.className = (result.props.className ?? "") + " btr-owned"

						const parent = reactHook.queryElement(result, (x: any) =>
							x.props.className?.includes("item-card-link"),
						)

						if (parent) {
							let children = parent.props.children

							if (!Array.isArray(children)) {
								children = parent.props.children = children ? [children] : []
							}

							children.unshift(
								reactHook.createElement("span", {
									className: "btr-item-owned",
									children: reactHook.createElement("span", {
										className: "icon-checkmark-white-bold",
										title: "You own this item",
									}),
								}),
							)
						}
					}
				}

				return result
			},
		)
	},
	inventoryTools: () => {
		angularHook.hijackModule("inventory", {
			inventoryContentController(target: any, thisArg: any, args: any[], argsMap: any) {
				const result = target.apply(thisArg, args)

				try {
					const { $scope } = argsMap

					$scope.$watch("$ctrl.assets", () => {
						setTimeout(() => contentScript.send("inventoryUpdateEnd"), 0)
					})
				} catch (ex) {
					console.error(ex)
					if (IS_DEV_MODE) {
						alert("hijackAngular Error")
					}
				}

				return result
			},
		})
	},
	refreshInventory: () => {
		const scope = angular.element(document.querySelector("assets-explorer")).scope()
		const ctrl = scope?.$parent?.$ctrl

		if (ctrl) {
			const real1 = ctrl.cursorPager.loadPreviousPage
			const real2 = ctrl.assetsPager.canLoadPreviousPage

			ctrl.cursorPager.loadPreviousPage = ctrl.cursorPager.reloadCurrentPage
			ctrl.assetsPager.canLoadPreviousPage = () => true

			try {
				ctrl.assetsPager.loadPreviousPage()
			} catch (ex) {}

			ctrl.cursorPager.loadPreviousPage = real1
			ctrl.assetsPager.canLoadPreviousPage = real2
		}
	},
	itemdetails: () => {
		reactHook.hijackConstructor(
			(props: any) => "itemDetails" in props,
			(target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)

				try {
					const props = args[0]

					if (result?.props?.className?.includes("item-details-info-header")) {
						const { itemDetails } = props

						result.props.children.splice(
							1,
							0,
							reactHook.createElement("div", {
								className: "btr-buttons",
								dangerouslySetInnerHTML: { __html: "" },

								"data-btr-asset-id": itemDetails.id,
								"data-btr-asset-type-id": itemDetails.assetType,
								"data-btr-item-type": itemDetails.itemType,
							}),
						)
					}
				} catch (ex) {
					console.error(ex)
				}

				return result
			},
		)
	},
}
