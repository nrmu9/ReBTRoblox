import { settings } from "@/entries/inject/state"
import { onSet, hijackFunction, hijackXHR } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions for the avatar editor.

export const avatarFunctions: Record<string, (...args: any[]) => any> = {
	avatar: () => {
		let openAdvancedAccessories: any

		reactHook.hijackConstructor(
			(props: any) => !openAdvancedAccessories && "openAdvancedAccessories" in props,
			(target: any, thisArg: any, args: any[]) => {
				openAdvancedAccessories = args[0].openAdvancedAccessories
				return target.apply(thisArg, args)
			},
		)

		reactHook.inject(".redraw-avatar", (redraw: any) => {
			redraw.classList.add("btr-redraw-avatar")

			redraw.append(
				reactHook.createElement(
					"a",
					{
						className: "text-link btr-advanced-button",
						onClick: () => openAdvancedAccessories(),
					},
					"Advanced",
				),
			)
		})
	},
	fullRangeBodyColors: () => {
		let forceRefreshThumbnail: any

		reactHook.hijackConstructor(
			(props: any) => !forceRefreshThumbnail && "forceRefreshThumbnail" in props,
			(target: any, thisArg: any, args: any[]) => {
				forceRefreshThumbnail = args[0].forceRefreshThumbnail
				return target.apply(thisArg, args)
			},
		)

		contentScript.listen("forceRefreshThumbnail", () => {
			forceRefreshThumbnail?.()
		})

		contentScript.listen("skinColorError", () => {
			Roblox.BootstrapWidgets.ToggleSystemMessage(
				$(".alert-warning"),
				100,
				2000,
				"Failed to update skin tone.",
			)
		})

		hijackXHR((request: any) => {
			if (request.url.endsWith("/set-body-colors")) {
				request.onResponse.push(() => {
					contentScript.send("updateBodyColors")
				})
			}
		})
	},
	// Adjusting accessories: the editor's own state and save are used, so its
	// preview, its list and Roblox all agree, and its next save keeps the change.
	// Both live in React contexts, read here as the editor renders.
	adjustAccessories: () => {
		// The types Roblox lets you move, turn and size (avatar-rules accessoryRefinementTypes).
		const ADJUSTABLE = [8, 42, 43, 44, 45, 46]

		let actions: any
		let worn: any
		let lastList: any
		let refreshThumbnail: any
		let pending: ReturnType<typeof setTimeout> | undefined

		const adjustable = () =>
			((worn?.currentlyWornAssetsList ?? []) as any[])
				.filter((asset) => ADJUSTABLE.includes(asset?.assetType?.id))
				.map((asset) => ({
					id: asset.id,
					name: asset.name,
					assetTypeId: asset.assetType.id,
					assetTypeName: asset.assetType.name,
					meta: asset.meta ?? null,
				}))

		// Through the React hook, not a second trap on window.React: trapping it
		// here as well stopped Remove Accessory Limits from working (issue 8).
		reactHook.whenReady((React: any) => {
			hijackFunction(React, "useContext", (target: any, thisArg: any, args: any[]) => {
				const value = target.apply(thisArg, args)

				if (value && typeof value === "object") {
					if (typeof value.setWearingAssets === "function") {
						actions = value
					} else if (Array.isArray(value.currentlyWornAssetsList)) {
						worn = value

						// Never during render: tell the panel once the list settles.
						if (value.currentlyWornAssetsList !== lastList) {
							lastList = value.currentlyWornAssetsList
							clearTimeout(pending)
							pending = setTimeout(() => contentScript.send("adjustWorn", adjustable()), 50)
						}
					}
				}

				return value
			})
		})

		reactHook.hijackConstructor(
			(props: any) => !refreshThumbnail && "forceRefreshThumbnail" in props,
			(target: any, thisArg: any, args: any[]) => {
				refreshThumbnail = args[0].forceRefreshThumbnail
				return target.apply(thisArg, args)
			},
		)

		reactHook.inject(".redraw-avatar", (redraw: any) => {
			redraw.append(
				reactHook.createElement(
					"a",
					{
						className: "text-link btr-adjust-button",
						onClick: () => contentScript.send("adjustOpen", adjustable()),
					},
					"Adjust",
				),
			)
		})

		contentScript.listen("adjustAsset", (assetId: number, meta: any) => {
			const list = worn?.currentlyWornAssetsList

			if (!actions || !Array.isArray(list) || !list.some((asset: any) => asset.id === assetId)) {
				contentScript.send("adjustResult", assetId, false)
				return
			}

			// A copy of the changed entry: the editor's own objects stay as they are.
			const next = list.map((asset: any) =>
				asset.id === assetId ? Object.assign({}, asset, { meta }) : asset,
			)

			Promise.resolve(actions.setWearingAssets(next))
				.then(() => {
					// The editor puts the old list back when Roblox turns it down.
					const saved = (worn?.currentlyWornAssetsList ?? []).find(
						(asset: any) => asset.id === assetId,
					)
					const ok = JSON.stringify(saved?.meta) === JSON.stringify(meta)

					if (ok) {
						refreshThumbnail?.()
					}

					contentScript.send("adjustResult", assetId, ok)
				})
				.catch(() => contentScript.send("adjustResult", assetId, false))
		})
	},
	removeAccessoryLimits: () => {
		const accessoryAssetTypeIds = [8, 41, 42, 43, 44, 45, 46, 47, 57, 58]
		const layeredAssetTypeIds = [64, 65, 66, 67, 68, 69, 70, 71, 72]

		// The editor used to read window.Roblox.AvatarAccoutrementService, so
		// hijacking that object was enough. Roblox now bundles the rules module
		// into the avatar bundle and calls its own copy, which the global never
		// sees. Webpack builds that copy with defineProperty getters, so rewrite
		// the descriptor as it is defined. Keep the global hooks below too: other
		// pages still go through them.
		const LIMIT_KEY = "getAdvancedAccessoryLimit"
		const LAYERED_KEY = "maxNumberOfLayeredClothingItems"
		const TYPE_KEY = "getAssetTypeById"
		const ADD_KEY = "addAssetToAvatar"

		// Raised rather than removed: the editor treats a missing maxNumber as 1.
		const RAISED_LIMIT = 100

		// Read per call rather than at registration: this hook installs at
		// document_start, before init has delivered settings, so gating it
		// up front would ignore the setting entirely.
		const bypassEnabled = () => settings.avatar?.removeAccessoryLimits !== false

		const isBypassed = (assetTypeId: any) =>
			bypassEnabled() &&
			(accessoryAssetTypeIds.includes(+assetTypeId) || layeredAssetTypeIds.includes(+assetTypeId))

		// Roblox added category caps (Tops, Bottoms, Outerwear all allow 1) that
		// short circuit before maxNumber is read, and the table holding them is
		// module private with no export to reach it. So let the original run and
		// put back what it dropped, which is what the hook below does for the
		// global copy.
		const keepDroppedAssets = (original: any) =>
			function (this: any, ...args: any[]) {
				const result = original.apply(this, args)

				if (!bypassEnabled()) {
					return result
				}

				const assets = [args[0], ...args[1]]

				let accessoriesLeft = 10
				let layeredLeft = 10

				for (let i = 0; i < assets.length; i++) {
					const asset = assets[i]
					const assetTypeId = asset?.assetType?.id

					const isAccessory = accessoryAssetTypeIds.includes(assetTypeId)
					const isLayered = layeredAssetTypeIds.includes(assetTypeId) || assetTypeId === 41

					let valid = true

					if (isAccessory || isLayered) {
						if (isAccessory && accessoriesLeft <= 0) {
							valid = false
						}

						if (isLayered && layeredLeft <= 0) {
							valid = false
						}

						if (
							!settings.avatar?.removeLayeredLimits &&
							layeredAssetTypeIds.includes(assetTypeId)
						) {
							if (!result.includes(asset)) {
								valid = false
							}
						}
					} else {
						valid = result.includes(asset)
					}

					if (valid) {
						if (isAccessory) {
							accessoriesLeft--
						}
						if (isLayered) {
							layeredLeft--
						}
					} else {
						assets.splice(i--, 1)
					}
				}

				return assets
			}

		const replaceValue = (key: string, original: any) => {
			if (key === ADD_KEY) {
				return keepDroppedAssets(original)
			}

			if (key === LAYERED_KEY) {
				// A plain number the editor compares a running count against.
				return settings.avatar?.removeLayeredLimits ? RAISED_LIMIT : original
			}

			if (key === TYPE_KEY) {
				// addAssetToAvatar derives its per type cap from this table, so raise
				// maxNumber in place. Mutating keeps the entry identity, which the
				// editor compares elsewhere.
				return (assetTypeId: any) => {
					const assetType = original(assetTypeId)

					if (assetType && isBypassed(assetType.id ?? assetTypeId)) {
						if (assetType.maxNumber < RAISED_LIMIT) {
							assetType.maxNumber = RAISED_LIMIT
						}
					}

					return assetType
				}
			}

			return (assetTypeId: any) => (isBypassed(assetTypeId) ? undefined : original(assetTypeId))
		}

		hijackFunction(Object, "defineProperty", (target: any, thisArg: any, args: any[]) => {
			const key = args[1]
			const descriptor = args[2]

			const isRulesKey = key === LIMIT_KEY || key === LAYERED_KEY || key === TYPE_KEY || key === ADD_KEY

			// Roblox's new Next.js site is built with Turbopack, which defines an
			// exported function as a plain value rather than a getter. The old
			// site's webpack build uses getters for everything.
			const isValue =
				isRulesKey &&
				!!descriptor &&
				"value" in descriptor &&
				(key === LAYERED_KEY
					? typeof descriptor.value === "number"
					: typeof descriptor.value === "function")

			if (isRulesKey && (typeof descriptor?.get === "function" || isValue)) {
				const readOriginal = isValue ? () => descriptor.value : descriptor.get
				let replacement: any
				let resolved = false

				const read = function (this: any) {
					if (!resolved) {
						resolved = true
						replacement = replaceValue(key, readOriginal.call(this))
					}

					return replacement
				}

				if (!isValue) {
					args[2] = { ...descriptor, get: read }
				} else if (key !== LAYERED_KEY) {
					// Kept a value, as the module seals the namespace right after.
					args[2] = { ...descriptor, value: read() }
				} else {
					// The layered count becomes a getter, so it reads the settings
					// once init has delivered them, not at document_start.
					const { enumerable, configurable } = descriptor
					args[2] = { enumerable, configurable, get: read }
				}

				const result = target.apply(thisArg, args)

				if (key === TYPE_KEY) {
					// addAssetToAvatar reads the per type cap through the module's own
					// binding, not through this namespace, so wrapping the getter alone
					// never runs for it. The entries it gets back are shared with this
					// table though, so walk every bypassed type once and raise
					// maxNumber in place. Deferred because the binding is not
					// initialised while the namespace is still being defined.
					const namespace = args[0]

					setTimeout(() => {
						try {
							const getAssetType = namespace[TYPE_KEY]

							for (const assetTypeId of [...accessoryAssetTypeIds, ...layeredAssetTypeIds]) {
								getAssetType(assetTypeId)
							}
						} catch (ex) {
							console.error(ex)
						}
					}, 0)
				}

				return result
			}

			return target.apply(thisArg, args)
		})

		onSet(window, "Roblox", (Roblox: any) => {
			onSet(Roblox, "AvatarAccoutrementService", (AvatarAccoutrementService: any) => {
				hijackFunction(
					AvatarAccoutrementService,
					"getAdvancedAccessoryLimit",
					(target: any, thisArg: any, args: any[]) => {
						if (
							accessoryAssetTypeIds.includes(+args[0]) ||
							layeredAssetTypeIds.includes(+args[0])
						) {
							return
						}

						return target.apply(thisArg, args)
					},
				)

				hijackFunction(
					AvatarAccoutrementService,
					"addAssetToAvatar",
					(target: any, thisArg: any, args: any[]) => {
						const result = target.apply(thisArg, args)
						const assets = [args[0], ...args[1]]

						let accessoriesLeft = 10
						let layeredLeft = 10

						for (let i = 0; i < assets.length; i++) {
							const asset = assets[i]
							const assetTypeId = asset?.assetType?.id

							const isAccessory = accessoryAssetTypeIds.includes(assetTypeId)
							const isLayered = layeredAssetTypeIds.includes(assetTypeId) || assetTypeId === 41

							let valid = true

							if (isAccessory || isLayered) {
								if (isAccessory && accessoriesLeft <= 0) {
									valid = false
								}

								if (isLayered && layeredLeft <= 0) {
									valid = false
								}

								if (
									!settings.avatar?.removeLayeredLimits &&
									layeredAssetTypeIds.includes(assetTypeId)
								) {
									if (!result.includes(asset)) {
										valid = false
									}
								}
							} else {
								valid = result.includes(asset)
							}

							if (valid) {
								if (isAccessory) {
									accessoriesLeft--
								}
								if (isLayered) {
									layeredLeft--
								}
							} else {
								assets.splice(i--, 1)
							}
						}

						return assets
					},
				)
			})
		})
	},
	ignoreR6Warning: () => {
		let confirming = false

		reactHook.hijackConstructor(
			// The R6 downgrade dialog is rendered as jsx(ps, { closeDialog, isOpen })
			// and takes nothing else. The outfit delete dialog reuses the same
			// confirm button id, so the prop count is what keeps this away from
			// the destructive ones.
			(props: any) => "closeDialog" in props && "isOpen" in props && Object.keys(props).length === 2,
			(target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)

				if (confirming || !args[0]?.isOpen || !settings.avatar?.ignoreR6Warning) {
					return result
				}

				const action = reactHook.queryElement(
					result,
					(elem: any) =>
						elem.props?.variant === "Emphasis" && typeof elem.props?.onClick === "function",
				)

				if (action) {
					confirming = true

					// Never during render: the click switches the avatar type and
					// strips layered clothing, both of which set state.
					setTimeout(() => {
						try {
							action.props.onClick()
						} catch (ex) {
							console.error(ex)
						} finally {
							confirming = false
						}
					}, 0)
				}

				return result
			},
		)
	},
}
