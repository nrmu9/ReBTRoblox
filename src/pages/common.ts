import { deferredPromise } from "@/core/deferred"
import { IS_DEV_MODE, THROW_DEV_WARNING } from "@/core/env"
import { html } from "@/core/html"
import { contentScript, injectScript } from "@/core/messaging"
import { currentPage } from "@/core/page"
import { assert, bufferToString, ready } from "@/core/util"
import { loadOptionalFeature } from "@/feat/loadfeature"
import { Navigation } from "@/feat/navigation"
import { RobuxToCash } from "@/feat/robuxtocash"
import { SETTINGS } from "@/feat/settings"
import { SettingsModal } from "@/feat/settingsmodal"
import { AssetCache } from "@/rbx/AssetCache"
import { AssetType } from "@/rbx/Constants"
import { RobloxApi } from "@/rbx/RobloxApi"
import { pageInit, pageReset } from "@/core/page"
import { btrFastSearch } from "@/feat/fastsearch"
import { btrAdblock } from "@/feat/adblock"
import { query } from "@/core/query"
import { onceFn } from "@/core/util"
import type { ItemPreviewer } from "@/rbx/Preview"

export const pageLoad: Record<string, any> = {}

export const onPageLoad = (fn: (...args: any[]) => void) => {
	const pageName = currentPage?.name
	assert(pageName)

	pageLoad[pageName] ??= []
	pageLoad[pageName].push(fn)
}

export const onPageReset = (fn: (...args: any[]) => void) => {
	const pageName = currentPage?.name
	assert(pageName)

	pageReset[pageName] ??= []
	pageReset[pageName].push(fn)
}

export let loggedInUserPromise = deferredPromise<number>()
export let loggedInUser = -1

export const setLoggedInUser = (userId: number): void => {
	loggedInUser = userId
}

const InvalidExplorableAssetTypeIds = [1, 3, 4, 5, 6, 7, 16, 21, 22, 32, 33, 34, 35, 37, 63]
const InvalidDownloadableAssetTypeIds = [21, 32, 34]

const ContainerAssetTypeIds = {
	curPage: undefined as any,
	maxPage: undefined as any,
	value: undefined as any,
	finished: undefined as any,
	[AssetType.EmoteAnimation]: (x: any) => x.findFirstChildOfClass("Animation")?.getProperty("AnimationId"),
	[AssetType.MeshPart]: (x: any) => x.findFirstChildOfClass("MeshPart")?.getProperty("MeshID", true),
	[AssetType.TShirt]: (x: any) => x.findFirstChildOfClass("ShirtGraphic")?.getProperty("Graphic"),
	[AssetType.Shirt]: (x: any) => x.findFirstChildOfClass("Shirt")?.getProperty("ShirtTemplate"),
	[AssetType.Pants]: (x: any) => x.findFirstChildOfClass("Pants")?.getProperty("PantsTemplate"),
	[AssetType.Decal]: (x: any) => x.findFirstChildOfClass("Decal")?.getProperty("Texture"),
	[AssetType.Face]: (x: any) => x.findFirstChildOfClass("Decal")?.getProperty("Texture"),
}

export const WearableAssetTypeIds = [
	2, 8, 11, 12, 17, 18, 27, 28, 29, 30, 31, 41, 42, 43, 44, 45, 46, 47, 64, 65, 66, 67, 68, 69, 70, 71, 72,
	76, 77, 79,
]
export const AnimationPreviewAssetTypeIds = [24, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61]
export const AccessoryAssetTypeIds = [
	8, 41, 42, 43, 44, 45, 46, 47, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72,
]

//

export const formatNumber = (num: number | string) =>
	String(num).replace(/(\d\d*?)(?=(?:\d{3})+(?:\.|$))/gy, "$1,")
export const formatUrlName = (name: string, def = "Name") =>
	encodeURIComponent(
		name
			.replace(/[']/g, "")
			.replace(/\W+/g, "-")
			.replace(/^-+|-+$/g, "") || def,
	)

//

export function onMouseEnter(
	element: HTMLElement,
	selector: string | ((el: HTMLElement) => void),
	callback: (...args: any[]) => void,
) {
	if (typeof selector === "function") {
		element.$on("mouseenter", () => selector(element))
		return
	}

	let hovering = false

	element.$on("mouseover", selector, (event: Event) => {
		if (!hovering) {
			hovering = true

			const currentTarget = event.currentTarget as HTMLElement
			currentTarget.$on(
				"mouseleave",
				() => {
					hovering = false
				},
				{ once: true },
			)

			callback(currentTarget)
		}
	})
}

//

export function startDownload(blobUrl: string, fileName: string) {
	const link = document.createElement("a")
	link.setAttribute("download", fileName || "file")
	link.setAttribute("href", blobUrl)
	document.body.append(link)
	link.click()
	link.remove()
}

export function getAssetFileType(assetTypeId: number, input: ArrayBuffer | Uint8Array) {
	const buffer = input instanceof ArrayBuffer ? new Uint8Array(input) : input

	switch (assetTypeId) {
		case 1:
			if (buffer) {
				switch (buffer[0]) {
					case 0xff:
						return "jpg"
					case 0x89:
					default:
						return "png"
					case 0x4d:
						return "tif"
					case 0x49:
						return "tif"
					case 0x47:
						return "gif"
					case 0x42:
						return "bmp"
				}
			}

			return "png"
		case 3:
			if (buffer) {
				const header = bufferToString(buffer.subarray(0, 4))
				switch (header) {
					case "RIFF":
						return "wav"
					case "OggS":
						return "ogg"
					default:
						return "mp3"
				}
			}

			return "mp3"
		case 4:
			return "mesh"
		case 63:
			return "xml"
		case 9:
			return (buffer && buffer[7] !== 0x21 && "rbxlx") || "rbxl"
		default:
			return (buffer && buffer[7] !== 0x21 && "rbxmx") || "rbxm"
	}
}

//

/**
 * A pager element, augmented in place by createPager.
 *
 * setMaxPage and the total counter only exist on the selectable variant, but no
 * caller mixes the two, so they are declared unconditionally rather than forcing
 * optional chaining on every use.
 */
export interface Pager extends HTMLElement {
	curPage: number
	maxPage: number
	setPage(page: number): void
	setMaxPage(maxPage: number): void
	togglePrev(enabled: boolean): void
	toggleNext(enabled: boolean): void
	onsetpage?: (page: number) => void
	onprevpage?: () => void
	onnextpage?: () => void
}

export function createPager(noSelect?: boolean, hideWhenEmpty?: boolean): Pager {
	const pager = html` <div class="btr-pager-holder">
		<ul class="btr-pager">
			<li class="btr-pager-prev">
				<button class="btn-generic-left-sm">
					<span class="icon-left"></span>
				</button>
			</li>
			<li class="btr-pager-mid"><span>Page </span><span class="btr-pager-cur"></span></li>
			<li class="btr-pager-next">
				<button class="btn-generic-right-sm">
					<span class="icon-right"></span>
				</button>
			</li>
		</ul>
	</div>` as Pager

	if (!noSelect) {
		pager.$req(".btr-pager-mid").replaceWith(
			html` <li class="btr-pager-mid">
				<span>Page</span><input class="btr-pager-cur" type="text" value="1" /><span
					>of <span class="btr-pager-total"></span
				></span>
			</li>`,
		)
	}

	const prev = pager.$req(".btr-pager-prev")
	const next = pager.$req(".btr-pager-next")
	const cur = pager.$req<HTMLInputElement>(".btr-pager-cur")

	pager.curPage = 1
	pager.maxPage = 1

	pager.togglePrev = (enabled) => {
		prev.$req<HTMLButtonElement>("button").disabled = !enabled
	}
	pager.toggleNext = (enabled) => {
		next.$req<HTMLButtonElement>("button").disabled = !enabled
	}

	pager.setPage = (page) => {
		pager.curPage = page

		if (noSelect) {
			cur.textContent = String(page)
			pager.togglePrev(page > 1)
		} else {
			cur.value = String(page)
			pager.togglePrev(page > 1)
			pager.toggleNext(page < pager.maxPage)
		}
	}

	pager.setPage(1)

	prev.$req("button").$on("click", (ev) => {
		pager.onprevpage?.()
		ev.preventDefault()
	})

	next.$req("button").$on("click", (ev) => {
		pager.onnextpage?.()
		ev.preventDefault()
	})

	if (!noSelect) {
		const tot = pager.$req(".btr-pager-total")

		pager.onprevpage = () => {
			if (pager.curPage > 1) {
				pager.onsetpage?.(pager.curPage - 1)
			}
		}
		pager.onnextpage = () => {
			if (pager.curPage < pager.maxPage) {
				pager.onsetpage?.(pager.curPage + 1)
			}
		}

		pager.setMaxPage = (maxPage) => {
			pager.maxPage = maxPage
			tot.textContent = String(maxPage)

			if (hideWhenEmpty) {
				pager.style.display = maxPage < 2 ? "none" : ""
			}

			pager.toggleNext(pager.curPage < maxPage)
		}

		pager.setMaxPage(1)

		{
			const updateInputWidth = () => {
				cur.style.width = "0px"
				cur.style.width = `${Math.max(32, Math.min(100, cur.scrollWidth + 12))}px`
			}

			cur.addEventListener("input", updateInputWidth)
			cur.addEventListener("change", updateInputWidth)

			// Reflect width changes made through the value property itself, which
			// neither event covers. The descriptor steps aside for each access so
			// the native accessor still does the real work.
			const descriptor: PropertyDescriptor = {
				configurable: true,

				get() {
					delete this.value
					const result = this.value
					Object.defineProperty(cur, "value", descriptor)
					return result
				},
				set(x) {
					delete this.value
					this.value = x
					Object.defineProperty(cur, "value", descriptor)
					updateInputWidth()
				},
			}

			Object.defineProperty(cur, "value", descriptor)
		}

		cur.$on<KeyboardEvent>("keydown", (e) => e.keyCode === 13 && cur.blur())
		cur.$on("blur", () => {
			let page = parseInt(cur.value, 10)

			if (!Number.isNaN(page) && pager.onsetpage) {
				page = Math.max(1, Math.min(pager.maxPage, page))

				if (pager.curPage !== page) {
					pager.onsetpage(page)
				} else {
					pager.setPage(page)
				}
			} else {
				cur.value = String(pager.curPage)
			}
		})
	}

	return pager
}

//

let redirectIndexCounter = 0
export const redirectEvents = (from: HTMLElement, to: HTMLElement) => {
	const redirectIndex = redirectIndexCounter
	redirectIndexCounter += 2

	from.dataset.redirectEvents = String(redirectIndex)
	to.dataset.redirectEvents = String(redirectIndex + 1)

	injectScript.call(
		"redirectEvents",
		(fromSelector: string, toSelector: string) => {
			const from = document.querySelector(fromSelector)
			const to = document.querySelector(toSelector)

			if (!from || !to) {
				console.log("redirectEvents fail", fromSelector, toSelector, from, to)
				return
			}

			const events = [
				"cancel",
				"click",
				"close",
				"contextmenu",
				"copy",
				"cut",
				"auxclick",
				"dblclick",
				"dragend",
				"dragstart",
				"drop",
				"focusin",
				"focusout",
				"input",
				"invalid",
				"keydown",
				"keypress",
				"keyup",
				"mousedown",
				"mouseup",
				"paste",
				"pause",
				"play",
				"pointercancel",
				"pointerdown",
				"pointerup",
				"ratechange",
				"reset",
				"seeked",
				"submit",
				"touchcancel",
				"touchend",
				"touchstart",
				"volumechange",
				"drag",
				"dragenter",
				"dragexit",
				"dragleave",
				"dragover",
				"mousemove",
				"mouseout",
				"mouseover",
				"pointermove",
				"pointerout",
				"pointerover",
				"scroll",
				"toggle",
				"touchmove",
				"wheel",
				"abort",
				"animationend",
				"animationiteration",
				"animationstart",
				"canplay",
				"canplaythrough",
				"durationchange",
				"emptied",
				"encrypted",
				"ended",
				"error",
				"gotpointercapture",
				"load",
				"loadeddata",
				"loadedmetadata",
				"loadstart",
				"lostpointercapture",
				"playing",
				"progress",
				"seeking",
				"stalled",
				"suspend",
				"timeupdate",
				"transitionend",
				"waiting",
				"change",
				"compositionend",
				"textInput",
				"compositionstart",
				"compositionupdate",
			]

			const methods = [
				"stopImmediatePropagation",
				"stopPropagation",
				"preventDefault",
				"getModifierState",
				"composedPath",
			]

			const redirected = new WeakSet()

			const callback = (event: Event) => {
				// dispatchEvent runs a capture phase, so a clone can re-enter this
				// capture listener if `to` is inside `from`. Never redirect twice.
				if (redirected.has(event)) {
					return
				}
				const clone = new (event.constructor as new (...args: any[]) => Event)(
					event.type,
					new Proxy(event, {
						// Forwards every property except bubbles, so the key is arbitrary.
						get(target, prop) {
							return prop === "bubbles"
								? false
								: (target as unknown as Record<string | symbol, any>)[prop]
						},
					}),
				)

				Object.defineProperties(clone, {
					target: { value: event.target },
					bubbles: { value: event.bubbles },
				})

				// The wrapped method names come from a runtime list, so both events
				// are indexed dynamically here.
				const clonedAsRecord = clone as unknown as Record<string, any>
				const eventAsRecord = event as unknown as Record<string, any>

				for (const method of methods) {
					if (typeof clonedAsRecord[method] === "function") {
						clonedAsRecord[method] = new Proxy(clonedAsRecord[method], {
							apply(target: any, thisArg: any, args: any[]) {
								if (thisArg === clone) {
									target.apply(thisArg, args)
									return eventAsRecord[method].apply(event, args)
								}

								return target.apply(thisArg, args)
							},
						})
					}
				}

				redirected.add(clone)

				if (!to.dispatchEvent(clone)) {
					event.preventDefault()
				}
			}

			for (const event of events) {
				from.addEventListener(event, callback, { capture: true })
			}
		},
		`[data-redirect-events="${redirectIndex}"]`,
		`[data-redirect-events="${redirectIndex + 1}"]`,
	)
}

//

const initReactFriends = () => {
	injectScript.call("initReactFriends", () => {
		reactHook.hijackConstructor(
			// FriendsCarouselContainer
			(props) => "profileUserId" in props && "carouselName" in props,
			(target: any, thisArg: any, args: any[]) => {
				// disable MustHideConnections so that friends load in faster
				reactHook.hijackUseState(
					(value, index) => value === false && index === 4,
					(value, initial) => (initial ? true : value),
				)

				const result = target.apply(thisArg, args)

				// if MustHideConnect is enabled, communicate that to profile code somehow
				if (reactHook.renderTarget?.state?.[4]?.[0] === false) {
					const noFriendsLabel = reactHook.querySelector(result, ".friends-carousel-0-friends")

					if (noFriendsLabel) {
						noFriendsLabel.props.className += " btr-friends-carousel-disabled"
					}
				}

				return result
			},
		)

		reactHook.hijackConstructor(
			// FriendsList
			(props) => "friendsList" in props,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]
				const friendsList = props.friendsList
				const carouselName = props.carouselName

				let showSecondRow = false

				if (carouselName === "WebHomeFriendsCarousel") {
					showSecondRow = settings.home.friendsSecondRow
				} else if (carouselName === "WebProfileFriendsCarousel") {
					showSecondRow = settings.home.friendsSecondRow

					// Fixes an issue where profile friends list shows one too few friends
					props.isAddFriendsTileEnabled = false
				}

				if (showSecondRow) {
					reactHook.hijackUseState(
						// visibleFriendsList
						(value, index) => value === friendsList,
						(value, initial) => {
							if (value && friendsList && !initial) {
								let count = value.length * 2

								if (carouselName === "WebHomeFriendsCarousel") {
									const isTwoLines = value.length < friendsList.length
									localStorage.setItem(
										"BTRoblox:homeFriendsIsTwoLines",
										isTwoLines ? "true" : "false",
									)

									// account for Add Friends button
									count += 1
								}

								return friendsList.slice(0, count)
							}

							return value
						},
					)
				}

				const result = target.apply(thisArg, args)

				try {
					result.props.className = `${result.props.className ?? ""} btr-friends-list`
				} catch (ex) {
					console.error(ex)
				}

				if (showSecondRow) {
					try {
						result.props.className = `${result.props.className ?? ""} btr-friends-secondRow`
					} catch (ex) {
						console.error(ex)
					}

					if (carouselName === "WebHomeFriendsCarousel") {
						if (
							!friendsList &&
							localStorage.getItem("BTRoblox:homeFriendsIsTwoLines") === "true"
						) {
							try {
								result.props.className = `${result.props.className ?? ""} btr-friends-loading-two-lines`
							} catch (ex) {
								console.error(ex)
							}
						}
					}
				}

				return result
			},
		)

		if (settings.home.friendsShowUsername) {
			const friendsState = reactHook.createGlobalState({})

			hijackXHR((request: any) => {
				if (
					request.method === "POST" &&
					request.url === "https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles"
				) {
					request.onRequest.push((request: any) => {
						const json = JSON.parse(request.body)

						if (!json.fields.includes("names.username")) {
							json.fields.push("names.username")
						}

						request.body = JSON.stringify(json)
					})

					request.onResponse.push((json: any) => {
						for (const user of json.profileDetails) {
							friendsState.value[user.userId] = user
						}

						friendsState.update()
					})
				}
			})

			reactHook.hijackConstructor(
				// FriendTileContent
				(props) => props.displayName && props.userProfileUrl,
				(target: any, thisArg: any, args: any[]) => {
					const result = target.apply(thisArg, args)

					try {
						const userId = args[0].id

						const labels = reactHook.queryElement(result, (x) =>
							x.props.className?.includes("friends-carousel-tile-labels"),
						)
						if (labels && Array.isArray(labels.props.children)) {
							const friends = reactHook.useGlobalState(friendsState)
							const friend = friends[userId]

							if (friend) {
								labels.props.children.splice(
									1,
									0,
									reactHook.createElement("div", {
										className:
											"friends-carousel-tile-sublabel btr-friends-carousel-username-label",
										children: reactHook.createElement("span", {
											className: "btr-friends-carousel-username",
											children: `@${friend.names.username}`,
										}),
									}),
								)
							}
						}
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			)
		}

		if (settings.home.friendPresenceLinks) {
			reactHook.hijackConstructor(
				// FriendTileDropdown
				(props) => props.friend && props.gameUrl,
				(target: any, thisArg: any, args: any[]) => {
					const result = target.apply(thisArg, args)

					try {
						const card = result.props.children?.[0]

						if (card?.props.className?.includes("in-game-friend-card")) {
							result.props.children[0] = reactHook.createElement("a", {
								href: args[0].gameUrl,
								style: { display: "contents" },
								onClick: (event: Event) => event.preventDefault(),
								children: card,
							})
						}
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			)
		}
	})
}

const initReactRobuxToCash = () => {
	if (!RobuxToCash.isEnabled()) {
		return
	}

	injectScript.call("initReactRobuxToCash", () => {
		reactHook.inject(".text-robux-lg", (elem) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux)) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash-big",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".text-robux-tile", (elem) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux)) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash-tile",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".text-robux", (elem) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux)) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".icon-robux-container", (elem) => {
			const child = elem.find((x) => "amount" in x.props)

			if (child) {
				const cash = RobuxToCash.convert(child[0].props.amount ?? 0)

				child.after(
					reactHook.createElement("span", {
						className: "btr-robuxToCash",
						children: ` (${cash})`,
					}),
				)

				return
			}
		})
	})
}

//

const angularTemplateCache: Record<string, any> = {}

export const modifyAngularTemplate = (
	keyArray: string | string[],
	callback: (...templates: HTMLElement[]) => void,
) => {
	if (typeof keyArray === "string") {
		keyArray = [keyArray]
	}

	const listener = {
		finished: false,

		update() {
			for (const key of keyArray) {
				if (!angularTemplateCache[key].body) {
					return
				}
			}

			if (this.finished) {
				return
			}
			this.finished = true

			const args: any[] = []

			for (const key of keyArray) {
				const cacheEntry = angularTemplateCache[key]
				cacheEntry.listeners.delete(listener)
				args.push(cacheEntry.body)
			}

			try {
				callback(...args)
			} catch (ex) {
				console.error(ex)
			}

			for (const key of keyArray) {
				const cacheEntry = angularTemplateCache[key]
				injectScript.send("updateTemplate", key, cacheEntry.body.innerHTML)
			}
		},
	}

	for (const key of keyArray) {
		const cacheEntry = (angularTemplateCache[key] = angularTemplateCache[key] || {
			listeners: new Set(),
			listening: false,
		})
		cacheEntry.listeners.add(listener)

		if (!cacheEntry.listening) {
			cacheEntry.listening = true
			injectScript.send("listenForTemplate", key)
		}
	}

	if (IS_DEV_MODE) {
		ready(() =>
			setTimeout(() => {
				if (!listener.finished) {
					console.warn(`Missing templates in modifyTemplate ${JSON.stringify(keyArray)}`)
				}
			}, 5e3),
		)
	}
}

const initAngularTemplates = () => {
	injectScript.listen("initTemplate", (key: string, html: string) => {
		// self closing tag support
		html = html.replace(/<([\w-:]+)([^>]*)\/>/gi, "<$1$2></$1>")

		const cacheEntry = angularTemplateCache[key]
		cacheEntry.body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body

		for (const listener of cacheEntry.listeners.values()) {
			listener.update()
		}
	})
}

//

export const initPreview = async (assetId: number, assetTypeId: number | null, isBundle: boolean) => {
	if (!SETTINGS.get("itemdetails.itemPreviewer")) {
		return
	}

	const isPreviewable =
		assetTypeId !== null &&
		(AnimationPreviewAssetTypeIds.includes(assetTypeId) || WearableAssetTypeIds.includes(assetTypeId))
	if (!isBundle && !isPreviewable) {
		return
	}

	const previewerMode = SETTINGS.get("itemdetails.itemPreviewerMode")
	let autoLoading = false

	const assetPromises: any[] = []
	let currentOutfitId: any
	let playedAnimation: any
	let bundleType: string | undefined
	let preview: any

	let previewPromise = deferredPromise<ItemPreviewer | null>()

	const setOutfit = (outfitId: any) => {
		if (!preview) {
			currentOutfitId = outfitId
			return
		}

		preview.setBundleOutfit(outfitId)

		if (bundleType !== "AvatarAnimations") {
			preview.selectOutfit("bundle")
		}
	}

	const loadPreview = onceFn(async () => {
		const { ItemPreviewer } = (await loadOptionalFeature("previewer")) as any
		preview = new ItemPreviewer()

		if (currentOutfitId) {
			setOutfit(currentOutfitId)
		}

		// Add default animations
		const disabledTypes = [
			AssetType.ClimbAnimation,
			AssetType.FallAnimation,
			AssetType.IdleAnimation,
			AssetType.JumpAnimation,
			AssetType.RunAnimation,
			AssetType.SwimAnimation,
			AssetType.WalkAnimation,
			AssetType.Animation,
			AssetType.EmoteAnimation,
		]

		if (
			(assetTypeId === null || !disabledTypes.includes(assetTypeId)) &&
			bundleType !== "AvatarAnimations"
		) {
			const defaultAnimsR15 = {
				run: [913376220],
				walk: [913402848],
				swim: [913384386],
				swimidle: [913389285],
				jump: [507765000],
				idle: [507766388, 507766666],
				fall: [507767968],
				climb: [507765644],
			}

			const defaultAnimsR6 = {
				run: [180426354],
				walk: [],
				swim: [],
				swimidle: [],
				jump: [125750702],
				idle: [180435571, 180435792],
				fall: [180436148],
				climb: [180436334],
			}

			const applyAnimation = () => {
				const anims = preview.playerType === "R6" ? defaultAnimsR6 : defaultAnimsR15

				for (const [category, assetIds] of Object.entries(anims) as [string, any][]) {
					preview.removeBundleAnimations(category)

					for (const assetId of assetIds) {
						preview.addBundleAnimation(assetId, category, "")
					}
				}

				preview.playAnimation(anims.idle[0])
				preview.canStopAnimationIfAutoSkin = true
			}

			preview.on("playerTypeChanged", applyAnimation)
			applyAnimation()
		}

		previewPromise.$resolve(preview)
	})

	const addAsset = async (assetId: number, assetTypeId: number | null, assetName: string, meta: any) => {
		if (assetTypeId !== null && AnimationPreviewAssetTypeIds.includes(assetTypeId)) {
			await loadPreview()
			preview.setVisible(true)

			if (!autoLoading && (previewerMode === "always" || previewerMode === "animations")) {
				autoLoading = true
				ready(() => preview.setEnabled(true))
			}

			if (assetTypeId === 24) {
				// Animation asset, no need to process
				preview.addAnimation(assetId, assetName)

				if (!playedAnimation) {
					playedAnimation = true
					preview.initPlayerTypeFromPlayingAnimation = true
					preview.playAnimation(assetId)
				}
			} else if (assetTypeId === 61) {
				// Emote asset, contains an Animation
				const model = await AssetCache.loadModel(assetId)
				const animation = model.find((x: any) => x.ClassName === "Animation")
				const animationId = AssetCache.getAssetIdFromUrl(animation.AnimationId)

				preview.addAnimation(animationId, assetName)

				if (!playedAnimation) {
					playedAnimation = true
					preview.initPlayerTypeFromPlayingAnimation = true
					preview.playAnimation(animationId)
				}
			} else {
				// Avatar animation
				const model = await AssetCache.loadModel(assetId)
				const folder = model.find((x: any) => x.Name === "R15Anim")

				for (const value of folder.Children) {
					if (value.ClassName !== "StringValue") {
						continue
					}

					preview.removeBundleAnimations(value.Name)

					for (const animation of value.Children) {
						if (animation.ClassName !== "Animation") {
							continue
						}

						const animationId = AssetCache.getAssetIdFromUrl(animation.AnimationId)

						preview.addBundleAnimation(animationId, value.Name, assetName)

						if (!playedAnimation && (!isBundle || value.Name === "idle")) {
							playedAnimation = true
							preview.initPlayerTypeFromPlayingAnimation = true
							preview.playAnimation(animationId)
						}
					}
				}
			}
		} else if (assetTypeId !== null && WearableAssetTypeIds.includes(assetTypeId)) {
			await loadPreview()

			const asset = preview.addAssetPreview(assetId, assetTypeId, meta)
			if (!asset) {
				return
			}

			preview.setVisible(true)

			if (!autoLoading && previewerMode === "always") {
				autoLoading = true
				ready(() => preview.setEnabled(true))
			}
		}
	}

	if (document.visibilityState === "hidden") {
		await new Promise<void>((resolve) =>
			document.$on("visibilitychange", () => resolve(), { once: true }),
		)
	}

	if (isBundle) {
		assetPromises.push(
			RobloxApi.catalog.getBundleDetails(assetId).then(async (details: any) => {
				bundleType = details.bundleType

				const outfitPromise = new Promise((resolve) => {
					const promises: any[] = []

					for (const item of details.items) {
						if (item.type === "UserOutfit") {
							promises.push(
								RobloxApi.avatar.getOutfitDetails(item.id).then((details) => {
									if (details?.outfitType === "Avatar") {
										resolve(details)
									}
								}),
							)
						}
					}

					Promise.all(promises).then(() => resolve(null))
				})

				const bundlePromises: any[] = []

				bundlePromises.push(
					outfitPromise.then((outfit: any) => {
						if (outfit) {
							setOutfit(outfit.id)
						}
					}),
				)

				for (const item of details.items) {
					if (item.type === "Asset") {
						bundlePromises.push(
							AssetCache.resolveAsset(item.id).then(async (assetRequest: any) => {
								const outfit = await outfitPromise
								return addAsset(
									item.id,
									assetRequest.assetTypeId,
									item.name,
									(outfit as any)?.assets.find((x: any) => x.id === item.id)?.meta,
								)
							}),
						)
					}
				}

				return Promise.all(bundlePromises)
			}),
		)
	} else {
		assetPromises.push(
			addAsset(
				assetId,
				assetTypeId,
				query<HTMLElement>("#item-container")?.dataset.itemName || "Asset",
				undefined,
			),
		)
	}

	Promise.all(assetPromises)
		.then(async () => {
			if (!preview) {
				return null
			}

			await preview.waitForAppearance()

			let gotAnything = false

			for (const asset of preview.previewAssets.values()) {
				if (!asset.isEmpty()) {
					gotAnything = true
					break
				}
			}

			if (!gotAnything && !currentOutfitId && !playedAnimation) {
				console.log("We've got nothing, let's just remove previewer")
				preview.setEnabled(false)
				preview.setVisible(false)
			}
		})
		.finally(() => {
			if (!preview) {
				previewPromise.$resolve(null)
			}
		})

	return previewPromise
}

const canDownloadAssetCache: Record<string, any> = {}
const canDownloadAsset = (assetId: number, assetTypeId: number) =>
	(canDownloadAssetCache[assetId] =
		canDownloadAssetCache[assetId] ||
		(async () => {
			// NOTE: This assumes you have the marketplace/itemdetails page for the item open at the moment
			// Marketplace pages for models you don't have access to are hidden, so we dont need to check those

			if (
				/*assetTypeId === AssetType.Model ||*/ assetTypeId === AssetType.Plugin ||
				assetTypeId === AssetType.Audio
			) {
				const json = await RobloxApi.assetdelivery.requestAssetV2(String(assetId), {
					browserAssetRequest: true,
				})

				if (!json?.locations) {
					return false
				}
			}

			return true
		})())

export const initExplorer = async (assetId: any, assetTypeId: any, isBundle?: any) => {
	if (
		!SETTINGS.get("itemdetails.explorerButton") ||
		(!isBundle && InvalidExplorableAssetTypeIds.includes(assetTypeId))
	) {
		return
	}

	if (!isBundle) {
		const canDownload = await canDownloadAsset(assetId, assetTypeId)
		if (!canDownload) {
			return
		}
	}

	const btnCont = html` <div class="btr-explorer-button-container btr-temp-fixed">
		<a class="btr-explorer-button">
			<span class="btr-icon-explorer"></span>
		</a>
		<div class="btr-explorer-popover">
			<div class="btr-explorer-parent"></div>
		</div>
	</div>`

	loadOptionalFeature("explorer").then((mod: any) => {
		const explorer = new mod.Explorer()
		let explorerInitialized = false

		const popover = btnCont.$req(".btr-explorer-popover")
		popover.$req(".btr-explorer-parent").replaceWith(explorer.element)

		btnCont.$on("click", ".btr-explorer-button", () => {
			if (popover.classList.contains("visible")) {
				popover.classList.remove("visible")
				explorer.setActive(false)
				return
			}

			popover.classList.add("visible")
			popover.style.left = `calc(50% - ${popover.clientWidth / 2}px)`

			if (!explorerInitialized) {
				explorerInitialized = true

				const updateLoadingText = (perc: number) =>
					explorer.setLoadingText(`Loading... ${Math.floor(perc * 100 + 0.5)}%`)
				explorer.setLoadingText(`Downloading...`)

				if (isBundle) {
					let first = true
					RobloxApi.catalog.getBundleDetails(assetId).then(async (details: any) => {
						for (const item of details.items) {
							if (item.type === "Asset") {
								AssetCache.loadModel(
									item.id,
									{ async: true, onProgress: first && updateLoadingText },
									(model: any) => explorer.addModel(item.name, model),
								)
								first = false
							}
						}
					})
				} else if (assetTypeId === AssetType.Head || assetTypeId === AssetType.DynamicHead) {
					AssetCache.loadModel(
						assetId,
						{ async: true, onProgress: updateLoadingText, format: "avatar_meshpart_head" },
						(model: any) => {
							AssetCache.loadModel(assetId, { async: true }, (model: any) =>
								explorer.addModel("SpecialMesh", model),
							)
							explorer.addModel("MeshPart", model)
						},
					)
				} else if (AccessoryAssetTypeIds.includes(assetTypeId)) {
					AssetCache.loadModel(
						assetId,
						{ async: true, onProgress: updateLoadingText, format: "avatar_meshpart_accessory" },
						(model: any) => {
							if (assetTypeId <= AssetType.WaistAccessory) {
								// is not layered clothing
								AssetCache.loadModel(assetId, { async: true }, (model: any) =>
									explorer.addModel("SpecialMesh", model),
								)
							}
							explorer.addModel("MeshPart", model)
						},
					)
				} else {
					AssetCache.loadModel(
						assetId,
						{ async: true, onProgress: updateLoadingText },
						(model: any) =>
							explorer.addModel("Default", model, { open: assetTypeId !== AssetType.Place }),
					)
				}
			}

			explorer.select([])
			explorer.setActive(true)

			const popLeft =
				explorer.element.getBoundingClientRect().right + 276 >= document.documentElement.clientWidth
			explorer.element.$find(".btr-properties").classList.toggle("left", popLeft)
		})

		document.body.$on("mousedown", (ev) => {
			if (
				popover.classList.contains("visible") &&
				!btnCont.contains(ev.target as Node) &&
				!explorer.getRootElement().contains(ev.target)
			) {
				popover.classList.remove("visible")
				explorer.setActive(false)
			}
		})
	})

	return btnCont
}

export const initDownloadButton = async (assetId: any, assetTypeId: any, isBundle?: any) => {
	if (isBundle) {
		return
	}

	if (
		!SETTINGS.get("itemdetails.downloadButton") ||
		InvalidDownloadableAssetTypeIds.includes(assetTypeId)
	) {
		return
	}

	const canDownload = await canDownloadAsset(assetId, assetTypeId)
	if (!canDownload) {
		return
	}

	const btnCont = html` <div class="btr-download-button-container">
		<a class="btr-download-button">
			<span class="btr-icon-download"></span>
		</a>
	</div>`

	const downloadButton = btnCont.$req<HTMLAnchorElement>("a")

	const download = (data: any, fileType?: any) => {
		const title = query("#item-container .item-name-container h2")
		const fileName = `${(title && formatUrlName(title.textContent ?? "", "")) || assetId.toString()}.${fileType || getAssetFileType(assetTypeId, data)}`

		const blobUrl = URL.createObjectURL(new Blob([data], { type: "binary/octet-stream" }))
		startDownload(blobUrl, fileName)
		URL.revokeObjectURL(blobUrl)
	}

	const doNamedDownload = (event: Event) => {
		const target = event.currentTarget
		event.preventDefault()

		if (downloadButton.classList.contains("disabled")) {
			return
		}

		downloadButton.classList.add("disabled")
		downloadButton.classList.add("loading")

		const format = (target as HTMLElement).getAttribute("format") ?? undefined

		if (format === "obj") {
			AssetCache.loadMesh(assetId, (mesh: any) => {
				downloadButton.classList.remove("disabled")
				downloadButton.classList.remove("loading")

				const lines: any[] = []

				lines.push("o Mesh")

				for (let i = 0, len = mesh.vertices.length; i < len; i += 3) {
					lines.push(`v ${mesh.vertices[i]} ${mesh.vertices[i + 1]} ${mesh.vertices[i + 2]}`)
				}

				lines.push("")

				for (let i = 0, len = mesh.normals.length; i < len; i += 3) {
					lines.push(`vn ${mesh.normals[i]} ${mesh.normals[i + 1]} ${mesh.normals[i + 2]}`)
				}

				lines.push("")

				for (let i = 0, len = mesh.uvs.length; i < len; i += 2) {
					lines.push(`vt ${mesh.uvs[i]} ${mesh.uvs[i + 1]}`)
				}

				lines.push("")

				// only use the first lod
				const faces = mesh.faces.subarray(mesh.lods[0] * 3, mesh.lods[1] * 3)

				for (let i = 0, len = faces.length; i < len; i += 3) {
					const a = faces[i] + 1
					const b = faces[i + 1] + 1
					const c = faces[i + 2] + 1
					lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`)
				}

				download(lines.join("\n"), "obj")
			})
		} else {
			AssetCache.loadBuffer(
				assetId,
				{ browserAssetRequest: assetTypeId === AssetType.Audio, format: format },
				(buffer: ArrayBuffer) => {
					downloadButton.classList.remove("disabled")
					downloadButton.classList.remove("loading")

					if (!buffer) {
						alert("Failed to download")
						return
					}

					download(buffer)
				},
			)
		}
	}

	const assetUrl = AssetCache.toAssetUrl(assetId)

	if (assetTypeId === AssetType.Mesh) {
		const popoverTemplate = html` <div class="btr-download-popover">
			<ul>
				<li>
					<a class="btr-download" href="${assetUrl}">Download as .mesh</a>
				</li>
				<li>
					<a class="btr-download" format="obj">Download as .obj</a>
				</li>
			</ul>
		</div>`

		if (IS_DEV_MODE) {
			popoverTemplate.$req("ul").append(
				html` <li>
					<a class="btr-log-mesh">Print to console</a>
				</li>`,
			)

			btnCont.$on("click", ".btr-log-mesh", () => {
				AssetCache.loadMesh(assetId, (mesh: any) => {
					console.log(mesh)
				})
			})
		}

		downloadButton.$on("click", (event) => {
			event.preventDefault()
			event.stopPropagation()
			popoverTemplate.classList.toggle("visible")
		})

		document.$on("click", (event) => {
			if (popoverTemplate.classList.contains("visible")) {
				popoverTemplate.classList.toggle("visible")
			}
		})

		downloadButton.after(popoverTemplate)
		btnCont.$on("click", ".btr-download", doNamedDownload)
	} else if (assetTypeId === AssetType.Head || assetTypeId === AssetType.DynamicHead) {
		downloadButton.dataset.toggle = "popover"
		downloadButton.dataset.bind = "popover-btr-download"

		const popoverTemplate = html` <div class="rbx-popover-content" data-toggle="popover-btr-download">
			<ul class="dropdown-menu" role="menu">
				<li>
					<a class="btr-download" format="avatar_meshpart_head" href="${assetUrl}"
						>Download MeshPart</a
					>
				</li>
				<li>
					<a class="btr-download">Download SpecialMesh</a>
				</li>
			</ul>
		</div>`

		downloadButton.after(popoverTemplate)
		btnCont.$on("click", ".btr-download", doNamedDownload)
	} else if (AccessoryAssetTypeIds.includes(assetTypeId)) {
		if (assetTypeId <= AssetType.WaistAccessory) {
			downloadButton.dataset.toggle = "popover"
			downloadButton.dataset.bind = "popover-btr-download"

			const popoverTemplate = html` <div class="rbx-popover-content" data-toggle="popover-btr-download">
				<ul class="dropdown-menu" role="menu">
					<li>
						<a class="btr-download" format="avatar_meshpart_accessory" href="${assetUrl}"
							>Download MeshPart</a
						>
					</li>
					<li>
						<a class="btr-download">Download SpecialMesh</a>
					</li>
				</ul>
			</div>`

			downloadButton.after(popoverTemplate)
			btnCont.$on("click", ".btr-download", doNamedDownload)
		} else {
			downloadButton.href = assetUrl
			downloadButton.setAttribute("format", "avatar_meshpart_accessory")
			downloadButton.$on("click", doNamedDownload)
		}
	} else {
		downloadButton.href = assetUrl
		downloadButton.$on("click", doNamedDownload)
	}

	if (downloadButton.dataset.toggle) {
		setTimeout(() => {
			// a bit ugly, but eh
			injectScript.call("setupPopovers", () => {
				Roblox?.BootstrapWidgets?.SetupPopover(null, null, "[data-bind='popover-btr-download']")
			})
		}, 0)
	}

	return btnCont
}

export const initContentButton = async (assetId: any, assetTypeId: any, isBundle?: any) => {
	if (!SETTINGS.get("itemdetails.contentButton")) {
		return
	}

	const getAssetUrl = ContainerAssetTypeIds[assetTypeId]
	if (!getAssetUrl) {
		return
	}

	const canDownload = await canDownloadAsset(assetId, assetTypeId)
	if (!canDownload) {
		return
	}

	const btnCont = html` <div class="btr-content-button-container">
		<a class="btr-content-button disabled" href="#">
			<span class="btr-icon-content"></span>
		</a>
	</div>`

	AssetCache.loadModel(assetId, (model: any) => {
		const contentUrl = getAssetUrl(model)
		const contentId = AssetCache.getAssetIdFromUrl(contentUrl)

		if (contentId) {
			btnCont.$req<HTMLAnchorElement>(">a").href = `https://www.roblox.com/library/${contentId}/` // marketplace needs full domain
			btnCont.$req(">a").classList.remove("disabled")
		}
	})

	return btnCont
}

//

export const robloxExperiments: Record<string, any> = {}

pageInit.www = () => {
	// Init global features

	Navigation.init()
	SettingsModal.enable()

	// Init common react

	initReactFriends()
	initReactRobuxToCash()

	// Init common angular

	initAngularTemplates()

	//

	const headWatcher = document.$watch(">head").$then()
	const bodyWatcher = document
		.$watch(">body", (body: HTMLElement) => {
			body.classList.toggle("btr-no-hamburger", SETTINGS.get("navigation.noHamburger"))
			body.classList.toggle("btr-hide-ads", SETTINGS.get("general.hideAds"))
		})
		.$then()

	headWatcher.$watch(`meta[name="user-data"]`, (meta: any) => {
		const userId = +meta.dataset.userid

		loggedInUser = Number.isSafeInteger(userId) ? userId : -1
		loggedInUserPromise.$resolve(loggedInUser)
	})

	ready(() => loggedInUserPromise.$resolve(-1))

	//

	injectScript.call("addBTRSettings", () => {
		reactHook.inject("#settings-popover-menu", (elem) => {
			elem.prepend(
				reactHook.createElement("li", {
					dangerouslySetInnerHTML: {
						__html: `<a class="rbx-menu-item btr-settings-toggle">BTR Settings</a>`,
					},
				}),
			)
		})
	})

	bodyWatcher.$watch("#roblox-linkify", (linkify: HTMLElement) => {
		const index = linkify.dataset.regex!.search(/\|[^|]*shoproblox\\.com/)

		if (index !== -1) {
			linkify.dataset.regex! =
				linkify.dataset.regex!.slice(0, index) +
				/|twitter\.com|youtube\.com|youtu\.be|twitch\.tv/.source +
				linkify.dataset.regex!.slice(index)

			// Empty asHttpRegex matches everything, so every link will be unsecured, so fix that
			if (!linkify.dataset.asHttpRegex) {
				linkify.dataset.asHttpRegex = "^$"
			}
		} else {
			THROW_DEV_WARNING("linkify regex is not compatible")
		}
	})

	bodyWatcher
		.$watch("#navbar-robux")
		.$then()
		.$watchAll("#buy-robux-popover", (popover) => {
			const bal = popover.$find("#nav-robux-balance")
			if (!bal) {
				return
			}

			const span = html`<span
				style="display:block;opacity:0.75;font-size:small;font-weight:500;"
			></span>`
			let lastText: string | undefined

			const update = () => {
				if (!RobuxToCash.isEnabled()) {
					span.remove()
					return
				}

				const text = bal.firstChild?.textContent
				if (lastText === text) {
					return
				}

				lastText = text ?? undefined

				const amt = parseInt((text ?? "").replace(/\D/g, ""), 10)
				if (!Number.isSafeInteger(amt)) {
					return
				}

				span.textContent = RobuxToCash.convert(amt)
				bal.append(span)
				bal.style.flexDirection = "column"
			}

			new MutationObserver(update).observe(bal, { childList: true })
			update()

			SETTINGS.onChange("general.robuxToUSDRate", update)
		})

	// Init optional features

	if (SETTINGS.get("general.fastSearch")) {
		try {
			btrFastSearch.init()
		} catch (ex) {
			console.error(ex)
		}
	}

	if (SETTINGS.get("general.hideAds")) {
		try {
			btrAdblock.init()
		} catch (ex) {
			console.error(ex)
		}
	}

	if (SETTINGS.get("general.fixFirefoxLocalStorageIssue")) {
		injectScript.call("fixFirefoxLocalStorageIssue", () => {
			onSet(window, "CoreRobloxUtilities", (CoreRobloxUtilities: any) => {
				if (!CoreRobloxUtilities?.localStorageService?.saveDataByTimeStamp) {
					return
				}

				const lss = CoreRobloxUtilities.localStorageService
				const localCache: Record<string, any> = {}

				hijackFunction(lss, "storage", () => true)

				hijackFunction(
					lss,
					"removeLocalStorage",
					(fn: (...args: any[]) => void, thisArg: any, args: any[]) => {
						delete localCache[args[0]]
						return fn.apply(thisArg, args)
					},
				)

				hijackFunction(
					lss,
					"getLocalStorage",
					(fn: (...args: any[]) => void, thisArg: any, args: any[]) => {
						if (args[0] in localCache) {
							return JSON.parse(localCache[args[0]])
						}

						return fn.apply(thisArg, args)
					},
				)

				hijackFunction(
					lss,
					"setLocalStorage",
					(fn: (...args: any[]) => void, thisArg: any, args: any[]) => {
						try {
							delete localCache[args[0]]
							return fn.apply(thisArg, args)
						} catch (ex) {
							localCache[args[0]] = JSON.stringify(args[1])
							console.error(ex)
						}
					},
				)
			})
		})
	}

	if (SETTINGS.get("general.cacheRobuxAmount")) {
		injectScript.call("cacheRobuxAmount", () => {
			reactHook.hijackConstructor(
				(props) =>
					"isGetCurrencyCallDone" in props &&
					"isExperimentCallDone" in props &&
					"robuxAmount" in props,
				(target: any, thisArg: any, args: any[]) => {
					try {
						const props = args[0]

						if (props.isGetCurrencyCallDone && props.isExperimentCallDone) {
							if (Number.isSafeInteger(props.robuxAmount)) {
								localStorage.setItem("BTRoblox:cachedRobux", props.robuxAmount)
							}
						} else {
							const cachedRobux = localStorage.getItem("BTRoblox:cachedRobux")

							if (cachedRobux) {
								props.isExperimentCallDone = true
								props.isGetCurrencyCallDone = true
								props.robuxAmount = +cachedRobux
							}
						}
					} catch {}

					return target.apply(thisArg, args)
				},
			)
		})
	}

	if (SETTINGS.get("general.higherRobuxPrecision")) {
		injectScript.call("higherRobuxPrecision", () => {
			let hijackTruncValue = false

			onSet(window, "CoreUtilities", (CoreUtilities: any) => {
				hijackFunction(
					CoreUtilities.abbreviateNumber,
					"getTruncValue",
					(target: any, thisArg: any, args: any[]) => {
						if (hijackTruncValue && args.length === 1) {
							try {
								return target.apply(thisArg, [args[0], 100_000, null, 2])
							} catch (ex) {
								console.error(ex)
							}
						}

						return target.apply(thisArg, args)
					},
				)
			})

			reactHook.hijackConstructor(
				(props) => "robuxAmount" in props && !("isEligibleForVng" in props),
				(target: any, thisArg: any, args: any[]) => {
					hijackTruncValue = true
					const result = target.apply(thisArg, args)
					hijackTruncValue = false
					return result
				},
			)
		})
	}

	if (SETTINGS.get("home.hideFriendActivity")) {
		injectScript.call("hideFriendActivity", () => {
			hijackXHR((request: any) => {
				if (
					request.method === "POST" &&
					request.url.match(
						/^https:\/\/apis\.roblox\.com\/discovery-api\/omni-recommendation(-metadata)?$/i,
					)
				) {
					request.onResponse.push((json: any) => {
						if (json?.contentMetadata?.Game) {
							for (const gameData of Object.values(json.contentMetadata.Game) as any[]) {
								delete (gameData as any).friendActivityTitle
							}
						}
					})
				}
			})
		})
	}

	if (SETTINGS.get("avatar.removeAccessoryLimits")) {
		injectScript.call("removeAccessoryLimits", () => {
			const accessoryAssetTypeIds = [8, 41, 42, 43, 44, 45, 46, 47, 57, 58]
			const layeredAssetTypeIds = [64, 65, 66, 67, 68, 69, 70, 71, 72]

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
								const isLayered =
									layeredAssetTypeIds.includes(assetTypeId) || assetTypeId === 41

								let valid = true

								if (isAccessory || isLayered) {
									if (isAccessory && accessoriesLeft <= 0) {
										valid = false
									}

									if (isLayered && layeredLeft <= 0) {
										valid = false
									}

									if (
										!settings.avatar.removeLayeredLimits &&
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
		})
	}

	// Chat

	if (SETTINGS.get("general.hideChat")) {
		bodyWatcher.$watch("#chat-container", (cont: HTMLElement) => cont.remove())
	} else {
		if (SETTINGS.get("general.smallChatButton")) {
			bodyWatcher.$watch("#chat-container", (cont: HTMLElement) =>
				cont.classList.add("btr-small-chat-button"),
			)

			injectScript.call("smallChatButton", () => {
				angularHook.hijackModule("chat", {
					chatController(target: any, thisArg: any, args: any[], argsMap: any) {
						const result = target.apply(thisArg, args)

						try {
							const { $scope, chatUtility } = argsMap

							const library = $scope.chatLibrary
							const width = library.chatLayout.widthOfChat

							$scope.$watch(
								() => library.chatLayout.collapsed,
								(value: any) => {
									library.chatLayout.widthOfChat = value ? 54 + 6 : width
									chatUtility.updateDialogsPosition(library)
								},
							)
						} catch (ex) {
							console.error(ex)
							if (IS_DEV_MODE) {
								alert("hijackAngular Error")
							}
						}

						return result
					},
				})
			})
		}
	}

	// Experiments

	injectScript.listen("populateExperiment", (experiment: string, key: string, value: any) => {
		robloxExperiments[experiment] ??= {}
		robloxExperiments[experiment][key] = value

		if (typeof SettingsModal !== "undefined") {
			SettingsModal.robloxExperimentsChanged()
		}
	})

	injectScript.call("experiments", () => {
		const modified: Record<string, any> = {}
		const initial: Record<string, any> = {}
		const layers: Record<string, any> = {}

		const modify = (experiment: string, key: string, value: any) => {
			modified[experiment] ??= {}

			if (typeof value === "string") {
				try {
					modified[experiment][key] = JSON.parse(value)
				} catch (ex) {
					delete modified[experiment][key]
				}
			} else {
				delete modified[experiment][key]
			}

			if (layers[experiment]) {
				const modifiedValue = key in modified[experiment] ? modified[experiment][key] : value

				for (const layer of layers[experiment]) {
					layer[key] = modifiedValue
				}
			}
		}

		contentScript.listen("updateExperiment", modify)

		try {
			const saved = JSON.parse(settings.general.experiments || "{}")

			if (saved) {
				for (const [experiment, values] of Object.entries(saved) as [string, any][]) {
					for (const [key, value] of Object.entries(values as Record<string, any>) as [
						string,
						any,
					][]) {
						modify(experiment, key, value)
					}
				}
			}
		} catch (ex) {
			console.error(ex)
		}

		const populate = (experiment: string, key: string, value: any) => {
			if (key === "then" || key === "toJSON") {
				return
			}

			initial[experiment] ??= {}
			if (key in initial[experiment]) {
				return
			}

			initial[experiment][key] = value
			contentScript.send("populateExperiment", experiment, key, value)
		}

		onSet(window, "Roblox", (Roblox: any) => {
			onSet(Roblox, "ExperimentationService", (ExperimentationService: any) => {
				hijackFunction(
					ExperimentationService,
					"getAllValuesForLayer",
					(target: any, thisArg: any, args: any[]) => {
						let result = target.apply(thisArg, args)

						if (result instanceof Promise) {
							const experiment = args[0]

							result = result.then((layer) => {
								try {
									for (const [key, value] of Object.entries(layer) as [string, any][]) {
										populate(experiment, key, value)
									}

									layers[experiment] ??= []
									layers[experiment].push(layer)

									if (modified[experiment]) {
										for (const [key, modifiedValue] of Object.entries(
											modified[experiment],
										) as [string, any][]) {
											layer[key] = modifiedValue
										}
									}

									return new Proxy(layer, {
										get(target, key) {
											populate(experiment, String(key), undefined)
											return target[key]
										},
									})
								} catch (ex) {
									if (IS_DEV_MODE) {
										console.error(ex)
									}
								}

								return layer
							})
						}

						return result
					},
				)
			})
		})
	})
}
