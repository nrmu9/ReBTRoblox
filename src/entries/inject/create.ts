import { onSet, hijackFunction } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions for create.roblox.com, a Next app reached through its webpack chunks.

const ReBTRoblox: Record<string, any> = {}

export const createFunctions: Record<string, (...args: any[]) => any> = {
	webpackHook: () => {
		const webpackHook = {
			processedModules: new WeakSet(),
			propertyHandlers: new Map(),
			moduleHandlers: [] as any[],
			objects: {},

			onModule(fn: (...args: any[]) => any) {
				this.moduleHandlers.push(fn)
			},

			onProperty(keys: any, fn: (...args: any[]) => any) {
				if (!Array.isArray(keys)) {
					keys = [keys]
				}

				const callback =
					keys.length >= 2
						? (obj: any) => {
								for (const key of keys) {
									if (!Object.hasOwn(obj, key)) {
										return
									}
								}

								fn(obj)
							}
						: fn

				for (const key of keys) {
					let list = this.propertyHandlers.get(key)

					if (!list) {
						list = []

						Object.defineProperty(Object.prototype, key, {
							configurable: true,
							set(value) {
								Object.defineProperty(this, key, {
									configurable: true,
									enumerable: true,
									writable: true,
									value: value,
								})

								for (const fn of list) {
									try {
										fn(this)
									} catch (ex) {
										console.error(ex)
									}
								}
							},
						})

						if (!this.propertyHandlers.size) {
							const propertyHandlers = this.propertyHandlers

							Object.defineProperty = new Proxy(Object.defineProperty, {
								apply(target: any, thisArg: any, args: any[]) {
									const result = target.apply(thisArg, args as any)

									const list = propertyHandlers.get(args[1])
									if (list) {
										for (const fn of list) {
											try {
												fn(args[0])
											} catch (ex) {
												console.error(ex)
											}
										}
									}

									return result
								},
							})
						}

						this.propertyHandlers.set(key, list)
					}

					list.push(callback)
				}
			},

			init() {
				onSet(window, "webpackChunk_N_E", (chunks: any) => {
					const addChunk = (chunk: any) => {
						for (const id of Object.keys(chunk)) {
							hijackFunction(chunk, id, (target: any, thisArg: any, args: any[]) => {
								const result = target.apply(thisArg, args)

								try {
									const module = args[0].exports
									if (typeof module === "object" && !this.processedModules.has(module)) {
										this.processedModules.add(module)

										for (const fn of this.moduleHandlers) {
											try {
												;(fn as any)(module, target)
											} catch (ex) {
												console.error(ex)
											}
										}
									}
								} catch (ex) {
									console.error(ex)
								}

								return result
							})
						}
					}

					const override = (pushfn: (...args: any[]) => any) =>
						new Proxy(pushfn, {
							apply: (target: any, thisArg: any, args: any[]) => {
								for (const chunk of args) {
									try {
										addChunk(chunk[1])
									} catch (ex) {
										console.error(ex)
									}
								}

								return target.apply(thisArg, args)
							},
						})

					let pushoverride = override(chunks.push)

					Object.defineProperty(chunks, "push", {
						enumerable: false,
						configurable: true,
						set(fn) {
							pushoverride = override(fn)
						},
						get() {
							return pushoverride
						},
					})

					for (const chunk of chunks) {
						try {
							addChunk(chunk[1])
						} catch (ex) {
							console.error(ex)
						}
					}
				})
			},
		}

		const objects: Record<string, any> = webpackHook.objects

		objects.Mui = {}

		webpackHook.onModule((module: any, target: any) => {
			if ("jsx" in module && "jsxs" in module) {
				hijackFunction(module, "jsx", reactHook.onCreateElement.bind(reactHook))
				hijackFunction(module, "jsxs", reactHook.onCreateElement.bind(reactHook))
				objects.jsx = module.jsx
			} else if ("useState" in module && "useCallback" in module) {
				reactHook.onReact(module)
				objects.React = module
			}

			const moduleCode = target.toString()

			if (moduleCode.includes(`name:"MenuItem"`)) {
				objects.Mui.MenuItem = Object.values(module)[0]
			} else if (moduleCode.includes(`name:"Button"`)) {
				objects.Mui.Button = Object.values(module)[0]
			} else if (moduleCode.includes(`name:"Divider"`)) {
				objects.Mui.Divider = Object.values(module)[0]
			}
		})

		ReBTRoblox.webpackHook = webpackHook

		webpackHook.init()
	},
	createAssetOptions: () => {
		const { webpackHook } = ReBTRoblox
		const objects: Record<string, any> = webpackHook.objects

		const Link = (url: string, entry: any) =>
			objects.jsx("a", {
				href: url,
				style: { all: "unset", display: "contents" },
				className: "btr-next-anchor",
				children: entry,
				key: entry.key,
			})

		document.addEventListener("click", (ev) => {
			const anchor =
				(ev.target as HTMLElement).nodeName === "A"
					? ev.target
					: (ev.target as HTMLElement).closest("a")

			if ((anchor as HTMLElement | null)?.classList.contains("btr-next-anchor")) {
				if (!ev.shiftKey && !ev.ctrlKey && window.next?.router) {
					ev.preventDefault()
					window.next?.router.push((anchor as HTMLAnchorElement).href)
				}
			}
		})

		reactHook.hijackConstructor(
			(props: any) => props.itemType && props.updateItem,
			(target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)

				try {
					if (result?.props["data-testid"] === "experience-options-menu") {
						const children = [result.props.children].flat(10).filter((x) => x)
						result.props.children = children

						if (args[0].itemType === "Game") {
							let index = children.findIndex(
								(x) =>
									x?.props?.onClick &&
									reactHook.queryElement(
										x,
										(x: any) => x?.props?.itemKey === "Action.CopyURL",
									),
							)
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.key === "Action.OpenInNewTab")
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.key === "Action.CopyURL")
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.key === "Action.CopyUniverseID")
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.props.itemKey === "Action.CopyStartPlaceID")
							if (index !== -1) {
								children[index].props.style = { display: "none" }
							} // HACK: Keep in dom for styling purposes

							index = children.findIndex((x) => x?.key === "Action.OpenExperienceDetails")
							if (index !== -1) {
								const entry = children[index]
								delete entry.props.onClick

								children[index] = Link(
									`https://www.roblox.com/games/${args[0].creation.assetId}/`,
									entry,
								)
							}

							index = children.findIndex((x) => x?.key === "Action.ConfigureLocalization")
							if (index !== -1) {
								const entry = children[index]
								delete entry.props.onClick

								children[index] = Link(
									`/dashboard/creations/experiences/${args[0].creation.universeId}/localization`,
									entry,
								)
							}

							index = children.findIndex((x) => x?.key === "Action.ViewRealTimeStats")
							if (index !== -1) {
								const entry = children[index]
								delete entry.props.onClick

								children[index] = Link(
									`/dashboard/creations/experiences/${args[0].creation.universeId}/analytics/performance`,
									entry,
								)

								// HACK: Make a copy for styling purposes
								children.splice(index + 1, 0, {
									...entry,
									key: undefined,
									props: {
										...entry.props,
										children: null,
										style: { display: "none" },
									},
								})
							}

							index = children.findIndex((x) => x?.key === "Action.CreateBadge")
							if (index !== -1) {
								const entry = children[index]
								delete entry.props.onClick

								children[index] = Link(
									`/dashboard/creations/experiences/${args[0].creation.universeId}/badges/create`,
									entry,
								)
							}

							index = children.findIndex((x) => x?.key === "Action.OpenExperienceDetails")
							children.splice(
								index + 1,
								0,
								Link(
									`/dashboard/creations/experiences/${args[0].creation.universeId}/overview`,
									objects.jsx(objects.Mui.MenuItem, {
										children: "Configure Experience",
									}),
								),
								Link(
									`/dashboard/creations/experiences/${args[0].creation.universeId}/places/${args[0].creation.assetId}/configure`,
									objects.jsx(objects.Mui.MenuItem, {
										children: "Configure Start Place",
									}),
								),
							)
						} else if (args[0].itemType === "CatalogAsset") {
							let index = children.findIndex((x) => x?.key === "Action.OpenInNewTab")
							if (index !== -1) {
								children.splice(index, 1)
							}

							children.splice(
								0,
								0,
								Link(
									`https://www.roblox.com/catalog/${args[0].creation.assetId}/`,
									objects.jsx(objects.Mui.MenuItem, { children: "View on Roblox" }),
								),
								Link(
									`/dashboard/creations/catalog/${args[0].creation.assetId}/configure`,
									objects.jsx(objects.Mui.MenuItem, {
										children: "Configure Asset",
									}),
								),
							)

							index = children.findIndex((x) => x?.props?.itemKey === "Action.Analytics")
							if (index !== -1) {
								const entry = children[index]
								delete entry.props.onClick

								children[index] = Link(
									`/dashboard/creations/catalog/${args[0].creation.assetId}/analytics`,
									entry,
								)
							}

							index = children.findIndex((x) => x?.key === "Action.CopyURL")
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.props.children === "Copy Asset ID")
							if (index !== -1) {
								children.splice(index, 1)
							}

							index = children.findIndex((x) => x?.props.children === "Copy Asset URI")
							if (index !== -1) {
								children.splice(index, 1)
							}
						}
					}
				} catch (ex) {
					console.error(ex)
				}

				return result
			},
		)

		reactHook.hijackConstructor(
			(props: any) => props.menuItems && props.setMenuOpen,
			(target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)

				try {
					const parent = result?.props.children?.[1]
					if (parent?.props) {
						const children = [parent.props.children].flat(10).filter((x) => x)
						parent.props.children = children

						const assetDetail = children.find((x) => x?.key === "open-asset-detail")
						if (assetDetail) {
							const assetId = assetDetail.props.assetId

							let index = children.findIndex((x) => x?.key === "copy-asset-id")
							if (index !== -1) {
								children.splice(index, 1)
							}

							children.splice(
								children.indexOf(assetDetail) + 1,
								0,
								Link(
									`/dashboard/creations/store/${assetId}/configure`,
									objects.jsx(objects.Mui.MenuItem, {
										children: "Configure Asset",
									}),
								),
							)
						}
					}
				} catch (ex) {
					console.error(ex)
				}

				return result
			},
		)
	},
	createDownloadVersion: () => {
		const { webpackHook } = ReBTRoblox
		const objects: Record<string, any> = webpackHook.objects

		reactHook.hijackConstructor(
			(props: any) => "version" in props,
			(target: any, thisArg: any, args: any[]) => {
				const result = target.apply(thisArg, args)

				try {
					if (result?.props["data-testid"]?.startsWith("version-history")) {
						const version = args[0].version
						const right = result.props.children[3]

						if (!Array.isArray(right.props.children)) {
							right.props.children = [right.props.children]
						}

						right.props.children.unshift(
							objects.jsx(objects.Mui.Button, {
								className: "btr-download-version",
								btrVersion: version.assetVersionNumber,
								btrAssetId: version.assetId,
								size: "small",
								color: "secondary",
								style: {
									"margin-right": right.props.children[0] ? "5px" : "",
								},
								children: [
									objects.jsx("span", {
										className: "btr-mui-circular-progress-root",
										style: {
											width: "20px",
											height: "20px",
											position: "absolute",
											left: "7px",
											display: "none",
										},
										children: objects.jsx("svg", {
											className: "btr-mui-circular-progress-svg",
											focusable: false,
											viewBox: "22 22 44 44",
											children: objects.jsx("circle", {
												className: "btr-mui-circular-progress",
												"stroke-width": 3.6,
												fill: "none",
												cx: 44,
												cy: 44,
												r: 20.2,
											}),
										}),
									}),
									objects.jsx("svg", {
										className: "MuiSvgIcon-root btr-download-icon",
										focusable: false,
										viewBox: "0 0 24 24",
										style: {
											height: "19px",
											"margin-right": "5px",
											fill: "currentcolor",
										},
										children: objects.jsx("path", {
											d: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
										}),
									}),
									" ",
									"Download",
								],
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
	marketplacePageChanged: () => {
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
	},
}
