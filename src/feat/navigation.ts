import { dateSince } from "@/core/date"
import { html } from "@/core/html"
import { backgroundScript, injectScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"
import { SHARED_DATA } from "@/feat/sharedData"
import { loggedInUser, loggedInUserPromise } from "@/pages/common"
import { query } from "@/core/query"

/** What a caller passes to Navigation.register to describe one nav item. */
interface NavigationElementInfo {
	label?: string
	/** Where the item goes, watched for so it survives Roblox re-rendering. */
	selector?: string
	/** Replacement markup, cloned over the matched node. */
	html?: HTMLElement
	enabled?: boolean
	settings?: Record<string, any>
	class?: string
	update?: (node: HTMLElement) => void
	nodeAdded?: (node: HTMLElement) => void
	init?: () => void
	[key: string]: any
}

/**
 * A registered nav item: the descriptor above plus the bookkeeping register
 * adds. Settings are registered as elements too, which is why a parent link
 * lives here.
 */
interface NavigationElement extends NavigationElementInfo {
	name: string
	nodeSelector: string
	parent?: NavigationElement
	enabledByDefault: boolean
	isDefault: boolean
	addNode: (node: HTMLElement) => void
	updateAll: () => void
	setEnabled: (enabled?: boolean) => void
	saveState: () => void
}

export const Navigation = {
	enabled: undefined as any,
	isDefault: undefined as any,
	replacedTitle: undefined as any,
	loadedFeed: undefined as any,
	elements: {} as Record<string, any>,

	getElementStates() {
		const data = SETTINGS.get("navigation.elements")
		let elements: Record<string, any> = {}

		try {
			elements = JSON.parse(data || "[]")
		} catch (ex) {
			console.error(ex)
		}

		return Array.isArray(elements) ? {} : elements
	},

	register(name: string, elementInfo: NavigationElementInfo) {
		const enabledByDefault = elementInfo.enabled !== false

		const element: NavigationElement = (this.elements[name] = {
			nodeSelector: `.btr-nav-node-${name}`,
			class: name,

			update(node: HTMLElement) {
				node.style.display = this.enabled ? "" : "none"
			},

			...elementInfo,
			settings: {},
			name: name,

			enabledByDefault: enabledByDefault,
			enabled: enabledByDefault,
			isDefault: true,

			saveState() {
				const states = Navigation.getElementStates()
				const prevState = states[this.name]
				let state: { enabled?: boolean } | undefined

				if (!this.isDefault) {
					if (!state) {
						state = {}
					}
					state.enabled = this.enabled
				}

				if (JSON.stringify(prevState) !== JSON.stringify(state)) {
					states[this.name] = state
					SETTINGS.set("navigation.elements", JSON.stringify(states))
				}
			},

			setEnabled(enabled: boolean | undefined) {
				if (typeof enabled === "boolean") {
					this.enabled = enabled
					// Toggling back to where it started is the same state as never
					// having touched it, so it should stop counting as changed and
					// stop offering a reset.
					this.isDefault = enabled === this.enabledByDefault
				} else {
					this.enabled = this.enabledByDefault
					this.isDefault = true
				}

				this.saveState()
				this.updateAll()
			},

			updateAll() {
				for (const node of document.querySelectorAll(this.nodeSelector)) {
					this.updateNode(node)
					this.update?.(node)
				}
			},

			updateNode(node: HTMLElement) {
				let className = this.class
				let enabled = this.enabled

				if (className[0] === "!") {
					className = className.slice(1)
					enabled = !enabled
				}

				node.classList.toggle(`btr-nav-${className}`, enabled)
			},

			addNode(node: HTMLElement) {
				node.classList.add(this.nodeSelector.slice(1))

				this.updateNode(node)
				this.nodeAdded?.(node)
				this.update?.(node)

				for (const setting of Object.values(this.settings) as any[]) {
					if (setting.nodeSelector === this.nodeSelector) {
						setting.addNode?.(node)
					}
				}
			},
		})

		if (element.parent) {
			let settingName = element.name

			if (settingName.startsWith(`${element.parent.name}_`)) {
				settingName = settingName.slice(element.parent.name.length + 1)
			}

			;(element.parent.settings ??= {})[settingName] = element
		}

		if (elementInfo.settings) {
			for (const [name, setting] of Object.entries(elementInfo.settings) as [string, any][]) {
				setting.nodeSelector = element.nodeSelector
				setting.parent = element
				setting.class ??= name
				setting.update ??= null
				Navigation.register(`${element.name}_${name}`, setting)
			}
		}

		let state = this.getElementStates()[element.name]
		if (typeof state === "boolean") {
			state = { enabled: state }
		}

		if (typeof state?.enabled === "boolean") {
			element.enabled = state.enabled
			element.isDefault = false
		}

		if (SETTINGS.get("navigation.enabled") && location.host !== "create.roblox.com") {
			const attach = async () => {
				if (name !== "header_home" && name !== "header_robux") {
					await loggedInUserPromise
					if (loggedInUser === -1) {
						return
					}
				}

				// Every match, not the first: react replaces nav nodes, a sidebar
				// anchor whenever its badge count changes, and a replaced node has
				// to be hidden or marked again.
				if (element.selector) {
					document.$watchAll(element.selector, (node: HTMLElement) => {
						if (element.html) {
							const newNode = element.html.cloneNode(true) as HTMLElement
							node.replaceWith(newNode)
							node = newNode
						}

						element.addNode(node)
					})
				}

				try {
					element.init?.()
				} catch (ex) {
					console.error(ex)
				}
			}

			attach()
		}

		return element
	},

	init() {
		// Always on (even when logged out)

		Navigation.register("header_home", {
			label: "Show Home",

			init() {
				document
					.$watch("#header")
					.$then()
					.$watch(
						"ul.rbx-navbar",
						(navbar: HTMLElement) => {
							const button = html`<li class=cursor-pointer style="order:-1"><a class="font-header-2 nav-menu-title text-header" href=/home>Home</a></li>`
							navbar.append(button)
							this.addNode(button)
						},
						{ continuous: true },
					)
			},
		})

		Navigation.register("header_robux", {
			label: "Show Robux",
			enabled: false,

			init() {
				document
					.$watch("#header")
					.$then()
					.$watch(
						"ul.rbx-navbar",
						(navbar: HTMLElement) => {
							const robuxBtn =
								navbar.$find(
									`.rbx-navbar a[href^="/robux"], .rbx-navbar a[href^="/upgrades/robux"]`,
								)?.parentNode ||
								navbar.$find(
									`#navigation-robux-container, #navigation-robux-mobile-container`,
								)

							if (robuxBtn) {
								this.addNode(robuxBtn)
							}
						},
						{ continuous: true },
					)
			},
		})

		// Header

		Navigation.register("header_agebracket", {
			label: "Show Age Bracket",
			selector: ".age-bracket-label",
			enabled: false,
		})

		Navigation.register("header_notifications", {
			label: "Show Notifications",

			settings: {
				reduce_margins: { label: "Reduce Margin", enabled: true },
			},

			selector: "#navbar-stream",
			enabled: true,

			// Roblox has not moved its own bell to the new icon set yet, so it was
			// the one item left in the old filled style. It wears the new set's
			// bell instead, the same way our friends and messages items do.
			nodeAdded(node: HTMLElement) {
				node.$watch(
					".icon-common-notification-bell",
					(bell: HTMLElement) => {
						// The old class goes, as it carries the old sprite. The fallback
						// puts it back if the new icon turns out not to be there.
						bell.className = navIconClass("bell")
						checkNavIcon(node, "icon-common-notification-bell")
					},
					{ continuous: true },
				)
			},
		})

		const FRIENDS_LINK = `nav a[href*="/users/friends"]`
		const MESSAGES_LINK = `nav a[href*="/my/messages"]`
		const NOTIF_BADGE = ".foundation-web-badge"

		/** Mirror href and unread count from a left menu entry onto our own item. */
		const mirrorNavItem = (node: HTMLElement, linkSelector: string): void => {
			const orig = query<HTMLAnchorElement>(linkSelector)
			const origNotif = orig?.$find(NOTIF_BADGE)

			const notif = node.$req(".btr-nav-notif")
			const link = node.$req<HTMLAnchorElement>("a")

			if (orig) {
				link.href = orig.href
			}
			notif.textContent = origNotif?.textContent?.trim() ?? ""
			notif.style.display = origNotif ? "" : "none"
		}

		/**
		 * Re-run a header item whenever the left menu changes.
		 *
		 * React replaces the menu anchor outright when its badge count arrives, so
		 * an observer bound to the anchor we were handed dies with that node. Watch
		 * a stable ancestor instead. Our own items live in the header, outside this
		 * container, so the writes cannot feed back in.
		 */
		const observedNavSources = new Map<string, Node>()

		const observeNavSource = (node: HTMLElement, elementName: string): void => {
			const update = () => Navigation.elements[elementName].updateAll()
			const root = node.closest("#left-navigation-container") ?? node.parentElement ?? node

			// Each replaced anchor comes through here again, and one observer per
			// root is all it takes.
			if (observedNavSources.get(elementName) === root) {
				update()
				return
			}

			observedNavSources.set(elementName, root)

			new MutationObserver(update).observe(root, {
				childList: true,
				subtree: true,
				characterData: true,
				attributeFilter: ["href"],
			})

			update()
		}

		/**
		 * Our two header items wear Roblox's own button and icon classes, the same
		 * ones its robux and settings items use, so they follow Roblox's colours,
		 * hover and theme instead of copying them. The icons are the ones Roblox's
		 * sidebar uses for the same pages.
		 *
		 * Both come from Roblox's navigation stylesheet. If a rename ever leaves an
		 * icon without its mask, the item falls back to our own icon rather than
		 * showing nothing. Checked once styles have loaded, since before then every
		 * icon looks unstyled.
		 */
		const NAV_BUTTON_CLASS = "btn-navigation-nav-settings-md"
		const navIconClass = (name: string) =>
			`btr-nav-icon grow-0 shrink-0 basis-auto icon icon-regular-${name} size-[var(--icon-size-xlarge)] [vertical-align:middle]`

		const checkNavIcon = (node: HTMLElement, fallbackClass: string): void => {
			const check = () => {
				const icon = node.$find<HTMLElement>(".btr-nav-icon")
				if (!icon?.isConnected) {
					return
				}

				const style = getComputedStyle(icon)
				const mask = style.maskImage || style.getPropertyValue("-webkit-mask-image")

				if (!mask || mask === "none") {
					icon.className = `btr-nav-icon ${fallbackClass}`
				}
			}

			if (document.readyState === "complete") {
				check()
			} else {
				window.addEventListener("load", check, { once: true })
			}
		}

		Navigation.register("header_friends", {
			label: "Show Friends",

			settings: {
				show_notifs: { label: "Show Requests", enabled: true, class: "!hide_notifs" },
			},

			selector: "#btr-placeholder-friends",
			html: html` <li id="btr-navbar-friends" class="navbar-icon-item">
				<a class="${NAV_BUTTON_CLASS}" href="/users/friends" aria-label="Friends">
					<span class="${navIconClass("two-people")}" aria-hidden="true"></span>
					<span class="btr-nav-notif" style="display:none;"></span>
				</a>
			</li>`,

			update(node: HTMLElement) {
				node.style.display = this.enabled ? "" : "none"
				if (!this.enabled) {
					return
				}

				mirrorNavItem(node, FRIENDS_LINK)
			},

			nodeAdded(node: HTMLElement) {
				checkNavIcon(node, "icon-nav-friend-btr")
			},
		})

		Navigation.register("header_messages", {
			label: "Show Messages",

			settings: {
				show_notifs: { label: "Show Unread", enabled: true, class: "!hide_notifs" },
			},

			selector: "#btr-placeholder-messages",
			html: html` <li id="btr-navbar-messages" class="navbar-icon-item">
				<a class="${NAV_BUTTON_CLASS}" href="/my/messages" aria-label="Messages">
					<span class="${navIconClass("speech-bubble-align-center")}" aria-hidden="true"></span>
					<span class="btr-nav-notif" style="display:none;"></span>
				</a>
			</li>`,

			update(node: HTMLElement) {
				node.style.display = this.enabled ? "" : "none"
				if (!this.enabled) {
					return
				}

				mirrorNavItem(node, MESSAGES_LINK)
			},

			nodeAdded(node: HTMLElement) {
				checkNavIcon(node, "icon-nav-message-btr")
			},
		})

		// Sidebar

		// Roblox Plus's "share to get Robux" banner, the second item in the
		// sidebar. Hidden by a stylesheet rule keyed on a class here rather than on
		// the node itself: react can recreate the node, and a rule that matches
		// nothing is harmless if Roblox drops the banner.
		Navigation.register("sidebar_referral", {
			label: "Show Plus Referral Banner",
			enabled: false,

			init() {
				this.addNode(document.documentElement)
			},

			update() {},
		})

		// Roblox's sidebar links are found by where they point: its items carry
		// no ids or keys. Hiding the item hides its list entry.
		const SIDEBAR_ITEM = "#left-navigation-container nav li"
		const sidebarLink = (path: string) => `${SIDEBAR_ITEM} > a[href*="${path}"]`

		const hideSidebarItem = (name: string, label: string, selector: string, enabled = true) => {
			Navigation.register(name, {
				label,
				selector,
				enabled,

				update(node: HTMLElement) {
					;(node.parentElement ?? node).style.display = this.enabled ? "" : "none"
				},
			})
		}

		/**
		 * Puts one of our items after a Roblox sidebar link, copied from that link
		 * so it keeps Roblox's look. React owns the list and can render it again
		 * without the copy, so it goes back in whenever the link turns up anew.
		 */
		const addSidebarItem = (
			element: any,
			after: string,
			make: (anchor: HTMLAnchorElement) => HTMLElement,
		) => {
			const nodeClass = element.nodeSelector.slice(1)

			document.$watchAll<HTMLAnchorElement>(after, (anchor) => {
				const item = anchor.parentElement

				if (!item || item.nextElementSibling?.classList.contains(nodeClass)) {
					return
				}

				const node = make(anchor)
				item.after(node)
				element.addNode(node)
			})
		}

		/** A copy of a sidebar link pointing somewhere else, with its own icon. */
		const copySidebarLink = (anchor: HTMLAnchorElement, href: string, text: string, icon: string) => {
			const item = html`<li></li>`
			const link = anchor.cloneNode(true) as HTMLAnchorElement

			link.href = href
			// Roblox marks the page you are on with this; the copy is a page of its own.
			link.classList.toggle("bg-shift-200", location.pathname.toLowerCase().startsWith(href))
			link.$find(".text-truncate-end")!.textContent = text

			const iconNode = link.$find("[data-testid=foundation-web-icon]")
			if (iconNode) {
				iconNode.className = iconNode.className.replace(
					/\bicon-regular-[\w-]+/,
					`icon-regular-${icon}`,
				)
			}

			item.append(link)
			return item
		}

		hideSidebarItem("sidebar_home", "Show Home", sidebarLink("roblox.com/home"), false)
		hideSidebarItem("sidebar_trade", "Show Trade", sidebarLink("/trades"))
		hideSidebarItem("sidebar_plus", "Show Roblox Plus", `${SIDEBAR_ITEM} > a[href$="/plus"]`)
		hideSidebarItem(
			"sidebar_shop",
			"Show Official Store",
			`${SIDEBAR_ITEM} > button:has(.icon-regular-building-store)`,
		)
		hideSidebarItem("sidebar_giftcards", "Show Gift Cards", sidebarLink("/giftcards"))

		Navigation.register("sidebar_messages", {
			label: "Show Messages",

			settings: {
				show_notifs: { label: "Show Unread", enabled: true, class: "!hide_notifs" },
			},

			selector: MESSAGES_LINK,
			enabled: true,

			update(node: HTMLElement) {
				;(node.parentElement ?? node).style.display = this.enabled ? "" : "none"
			},

			nodeAdded(node: HTMLElement) {
				observeNavSource(node, "header_messages")
			},
		})

		Navigation.register("sidebar_friends", {
			label: "Show Friends",

			settings: {
				show_notifs: { label: "Show Requests", enabled: true, class: "!hide_notifs" },
			},

			selector: FRIENDS_LINK,
			enabled: true,

			update(node: HTMLElement) {
				;(node.parentElement ?? node).style.display = this.enabled ? "" : "none"
			},

			nodeAdded(node: HTMLElement) {
				observeNavSource(node, "header_friends")
			},
		})

		Navigation.register("sidebar_money", {
			label: "Show Transactions",
			enabled: false,

			init() {
				addSidebarItem(this, sidebarLink("/trades"), (anchor) =>
					copySidebarLink(anchor, "/transactions", "Transactions", "wallet"),
				)
			},
		})

		Navigation.register("sidebar_blogfeed", {
			label: "Show Blog Feed",

			init() {
				addSidebarItem(
					this,
					sidebarLink("blog.roblox.com"),
					() => html`<li id="btr-blogfeed-container"><div id="btr-blogfeed"></div></li>`,
				)
			},

			update(node: HTMLElement) {
				node.style.display = this.enabled ? "" : "none"

				if (this.enabled && !node.dataset.btrLoaded) {
					node.dataset.btrLoaded = "true"

					const blogfeed = node.$req("#btr-blogfeed")
					const parser = new DOMParser()

					const updateBlogFeed = (blogFeedData: any[]) => {
						blogfeed.replaceChildren()

						for (const item of blogFeedData) {
							blogfeed.append(
								html` <a class="btr-feed" href="${item.url}">
									<div class="btr-feedtitle">
										${item.title.trim() + " "}
										<span class="btr-feeddate">(${dateSince(item.date)})</span>
									</div>
									<div class="btr-feeddesc">
										${parser
											.parseFromString(item.desc, "text/html")
											.documentElement.textContent.replace(/\s+/g, " ")
											.trim()
											.slice(0, 220)}
									</div>
								</a>`,
							)
						}
					}

					backgroundScript.send("requestBlogFeed", (data: any[]) => updateBlogFeed(data))

					if (SHARED_DATA.get("blogfeed")) {
						updateBlogFeed(SHARED_DATA.get("blogfeed"))
					}
				}
			},
		})

		if (SETTINGS.get("navigation.enabled") && location.host !== "create.roblox.com") {
			injectScript.call("navigation")
		}
	},
}
