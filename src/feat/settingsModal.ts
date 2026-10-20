import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { assert } from "@/core/util"
import { Navigation } from "@/feat/navigation"
import { RobuxToCash } from "@/feat/robuxToCash"
import { DEFAULT_SETTINGS, SETTINGS } from "@/feat/settings"
import { SHARED_DATA } from "@/feat/sharedData"
import { robloxExperiments } from "@/pages/common"
import { discoverExperimentHints, type ExperimentHint } from "@/feat/experimentHints"
import { HOME_ROWS_KEY } from "@/pages/home"
import { btrLocalStorage } from "@/core/storage"

interface SettingsModalState {
	enabled: boolean
	visible?: boolean
	settingsDiv?: any
	contentDivs?: any
	currentContent?: any
	themeObserver?: any
	[key: string]: any
}

export const SettingsModal: SettingsModalState = {
	enabled: false,

	toggle(force: boolean) {
		assert(this.enabled, "not enabled")
		this.init()

		// Tracked rather than derived from the parent: the node stays attached
		// while the close transition plays, so reopening inside that window used to
		// read as still visible and toggle straight back off.
		const visible = typeof force === "boolean" ? force : !this.visible
		this.visible = visible

		if (visible) {
			document.$watch(">body", (body: HTMLElement) => {
				if (!this.visible) {
					return
				}

				body.appendChild(this.settingsDiv)

				for (const icon of this.settingsDiv.$findAll(".icon")) {
					icon.classList.toggle("btr-icon-missing", getComputedStyle(icon).maskImage === "none")
				}

				// The open class has to land on a later frame than the mount, or the
				// starting state never paints and there is nothing to transition from.
				requestAnimationFrame(() => {
					if (this.visible) {
						this.settingsDiv.classList.add("btr-settings-open")
					}
				})
			})

			if (location.hostname === "create.roblox.com") {
				this.settingsDiv.classList.add("btr-dark-theme")
			} else {
				const copyThemeFromElement = (target: any) => {
					this.settingsDiv.classList.toggle(
						"btr-light-theme",
						target.classList.contains("light-theme"),
					)
					this.settingsDiv.classList.toggle(
						"btr-dark-theme",
						target.classList.contains("dark-theme"),
					)
				}

				document.$watch(
					".light-theme:not(.btr-settings-modal), .dark-theme:not(.btr-settings-modal)",
					(target: any) => {
						if (this.themeObserver || !this.settingsDiv.parentNode) {
							return
						}

						this.themeObserver = new MutationObserver(() => copyThemeFromElement(target))
						this.themeObserver.observe(target, { attributeFilter: ["class"], attributes: true })
						copyThemeFromElement(target)
					},
				)
			}

			const lastContentOpen = sessionStorage.getItem("btr-settings-open")
			if (lastContentOpen && this.contentDivs[lastContentOpen]) {
				this.switchContent(lastContentOpen)
			} else {
				this.switchContent("main")
			}
		} else {
			this.switchContent("main")

			sessionStorage.removeItem("btr-settings-open")

			// Stay mounted until the fade out finishes. transitionend alone would
			// strand the node if the animation never runs, so a timer backs it up.
			this.settingsDiv.classList.remove("btr-settings-open")

			const unmount = () => {
				if (!this.visible) {
					this.settingsDiv.remove()
				}
			}

			this.settingsDiv.addEventListener("transitionend", unmount, { once: true })
			setTimeout(unmount, 320)

			if (this.themeObserver) {
				this.themeObserver.disconnect()
				this.themeObserver = null
			}
		}
	},

	enable() {
		this.enabled = true
		document.$on("click", ".btr-settings-toggle", () => this.toggle())

		// Opens on a given page, for links elsewhere such as Home's hidden rows.
		document.addEventListener("btr-open-settings", (ev: Event) => {
			this.toggle(true)
			this.switchContent((ev as CustomEvent).detail || "general")
		})

		// we only want to remember settings visibility when navigating same-origin or through history
		if (
			sessionStorage.getItem("btr-settings-open") &&
			performance.getEntriesByType("navigation")[0]?.entryType === "navigate"
		) {
			let sameOrigin = false

			try {
				sameOrigin = new URL(document.referrer).host === location.host
			} catch (ex) {}

			if (!sameOrigin) {
				sessionStorage.removeItem("btr-settings-open")
			}
		}

		try {
			const url = new URL(window.location.href)

			if (url.searchParams.get("btr_settings_open")) {
				sessionStorage.setItem("btr-settings-open", "true")

				url.searchParams.delete("btr_settings_open")
				window.history.replaceState(null, "", url.toString())
			}
		} catch (ex) {}

		if (sessionStorage.getItem("btr-settings-open")) {
			try {
				this.toggle(true)
			} catch (ex) {
				console.error(ex)
			}
		}
	},

	switchContent(name: string) {
		assert(this.enabled, "not enabled")

		// "main" is what older sessions stored for the front page.
		if (name === "main" || !this.contentDivs?.[name]) {
			name = "general"
		}

		if (this.currentContent === name && !this.searching) {
			return
		}

		this.clearSearch?.()

		for (const [pageName, page] of Object.entries(this.contentDivs) as [string, HTMLElement][]) {
			page.classList.toggle("selected", pageName === name)
		}

		for (const tab of this.settingsDiv.$findAll(".btr-settings-tab")) {
			const selected = tab.dataset.page === name
			tab.classList.toggle("selected", selected)
			tab.setAttribute("aria-selected", String(selected))
		}

		this.settingsDiv.$req(".btr-settings-title").textContent = this.contentDivs[name].dataset.label
		this.settingsDiv.$req(".btr-settings-body").scrollTop = 0

		this.currentContent = name
		sessionStorage.setItem("btr-settings-open", name)

		if (name === "advanced") {
			this.loadExperimentHints()
		}
	},

	init() {
		assert(this.enabled, "not enabled")
		if (this.settingsDiv) {
			return
		}

		// Each <page> becomes a tab. A page with a path and toggle gets a switch
		// for its whole feature at the top, and its rows follow that switch.
		// <toggle> and <choice> are rows bound to a setting, relative to the page
		// path; `require` names the setting a row depends on, `!` inverting it.
		this.settingsDiv = html` <div class="btr-settings-modal">
			<div class="btr-settings" role="dialog" aria-modal="true" aria-label="ReBTRoblox settings">
				<aside class="btr-settings-sidebar">
					<div class="btr-settings-brand">
						<span class="btr-settings-brand-title">ReBTRoblox</span>
						<span class="btr-settings-brand-version"
							>v${chrome.runtime.getManifest().version}</span
						>
						<a
							class="btr-settings-brand-link"
							href="https://www.roblox.com/users/864843843/profile"
							target="_blank"
							rel="noopener"
							title="Made by pwu_p"
							aria-label="Made by pwu_p, on Roblox"
						>
							<span class="icon icon-filled-tilt" aria-hidden="true"></span>
						</a>
					</div>
					<label class="btr-settings-search">
						<span class="icon icon-regular-magnifying-glass" aria-hidden="true"></span>
						<input
							type="search"
							placeholder="Search settings"
							spellcheck="false"
							autocomplete="off"
						/>
						<button
							type="button"
							class="btr-settings-search-clear"
							aria-label="Clear search"
							title="Clear search"
							hidden
						>
							<span class="icon icon-regular-x" aria-hidden="true"></span>
						</button>
					</label>
					<nav class="btr-settings-tabs" role="tablist" aria-orientation="vertical"></nav>
				</aside>

				<div class="btr-settings-main">
					<header class="btr-settings-header">
						<h2 class="btr-settings-title"></h2>
						<button
							type="button"
							class="btr-settings-icon-button btr-settings-toggle"
							aria-label="Close"
							title="Close"
						>
							<span class="icon icon-regular-x" aria-hidden="true"></span>
						</button>
					</header>

					<div class="btr-settings-body">
						<page name="general" label="General" icon="gear" path="general">
							<toggle
								label="Hide Sponsored Experiences"
								path="hideSponsored"
								desc="Hides sponsored games"
							></toggle>
							<toggle
								label="Hide Disliked Games"
								path="home.hideDisliked"
								desc="Hides games you disliked from Home, Charts and search. It learns them as you open and vote on games"
							></toggle>
							<toggle
								label="Fast User Search"
								path="fastSearch"
								desc="Shows matching users as you type in search"
							></toggle>
							<toggle
								label="Voice Chat Status"
								path="voiceChatStatus"
								desc="Shows your voice chat status in the top bar"
							></toggle>
							<toggle
								label="Copy ID Menu Items"
								path="enableContextMenus"
								desc="Adds a Copy ID option when you right click games, items and users"
							></toggle>
							<toggle
								label="Higher Robux Precision"
								path="higherRobuxPrecision"
								desc="Shows your full balance instead of shortening it to 1.2K"
							></toggle>
							<toggle
								label="Show Robux While Loading"
								path="cacheRobuxAmount"
								desc="Shows your last balance while the current one loads"
							></toggle>

							<heading>Chat</heading>
							<toggle
								label="Show Chat"
								path="!hideChat"
								desc="Shows the chat in the corner of the page"
							></toggle>
							<toggle
								label="Minimize Chat"
								path="smallChatButton"
								require="!hideChat"
								desc="Shrinks the chat into a small button"
							></toggle>
							<toggle
								label="Fix Missing Messages"
								path="fixChatMessages"
								require="!hideChat"
								desc="Fixes chats that open without their newest messages"
							></toggle>

							<heading>Robux to Cash</heading>
							<div
								class="btr-setting-row btr-setting-row-block"
								data-search="robux cash currency conversion rate price money"
							>
								<div class="btr-setting-text">
									<span class="btr-setting-label">Conversion Rate</span>
									<span class="btr-setting-desc">Shows Robux prices in real money</span>
								</div>
								<button type="button" class="btr-setting-reset" path="general.robuxToUSDRate">
									Reset
								</button>
								<div class="btr-setting-selects">
									<span class="btr-select"
										><select id="btr-robuxToCash-currency" aria-label="Currency"></select
									></span>
									<span class="btr-select"
										><select id="btr-robuxToCash-rate" aria-label="Rate"></select
									></span>
								</div>
							</div>
						</page>

						<page
							name="navigation"
							label="Navigation"
							icon="three-bars-horizontal"
							path="navigation"
							toggle
							master="Customize navigation"
						>
							<toggle
								label="Keep Sidebar Open"
								path="noHamburger"
								require="false"
								desc="Keeps the sidebar open on wide screens"
							></toggle>
							<heading>Top Bar</heading>
							<div class="btr-settings-nav-list" data-kind="header"></div>
							<heading>Sidebar</heading>
							<div class="btr-settings-nav-list" data-kind="sidebar"></div>
						</page>

						<page name="home" label="Home" icon="house" path="home">
							<toggle
								label="Show More Friends"
								path="friendsSecondRow"
								desc="Shows a second row of friends"
							></toggle>
							<toggle
								label="Show Friend Usernames"
								path="friendsShowUsername"
								desc="Shows usernames under display names"
							></toggle>
							<toggle
								label="Link Friend Presence"
								path="friendPresenceLinks"
								desc="Lets you click the game a friend is playing"
							></toggle>
							<toggle
								label="Hide Friend Activity"
								path="hideFriendActivity"
								desc="Hides which friends are playing a game"
							></toggle>
							<toggle
								label="Move Favorites to Top"
								path="favoritesAtTop"
								desc="Moves your favorites to the top"
							></toggle>
							<toggle
								label="Show Player Counts"
								path="showRecommendationPlayerCount"
								desc="Shows how many people are playing each game"
							></toggle>
							<toggle
								label="Instant Game Hover"
								path="instantGameHoverAction"
								desc="Shows game details as soon as you hover a game"
							></toggle>
							<heading>Rows</heading>
							<div class="btr-settings-home-rows"></div>
						</page>

						<page
							name="profile"
							label="Profile"
							icon="person"
							path="profile"
							toggle
							master="Profile layout"
							desc="Uses the ReBTRoblox profile layout"
						>
							<toggle
								label="Embed Inventory"
								path="embedInventoryEnabled"
								desc="Shows the inventory on the profile"
							></toggle>
							<toggle
								label="Mark Mutual Communities"
								path="mutualCommunities"
								desc="Puts the communities you share first and marks them"
							></toggle>
							<toggle
								label="Last Seen Online"
								path="lastSeen"
								desc="Shows when ReBTRoblox last saw an offline user online. Only what this device has seen, so it can be out of date"
							></toggle>
							<toggle
								label="Exact Follower Counts"
								path="exactCounts"
								desc="Shows exact follower and following counts"
							></toggle>
						</page>

						<page
							name="gamedetails"
							label="Game Pages"
							icon="controller"
							path="gamedetails"
							toggle
							master="Game page features"
						>
							<toggle
								label="Exact Visit and Like Counts"
								path="exactCounts"
								desc="Shows exact visits, likes and favorites"
							></toggle>
							<toggle
								label="Paged Server List"
								path="addServerPager"
								desc="Splits the server list into pages"
							></toggle>
							<choice
								label="Server Info"
								path="showServerRegion"
								desc="Shows each server's ping or location"
							>
								<option value="none">Off</option>
								<option value="ping">Ping</option>
								<option value="region">Region</option>
								<option value="both">Ping and region</option>
								<option value="combined">Country only</option>
							</choice>
							<toggle
								label="Server Tools"
								path="serverTools"
								desc="Adds a button to join the smallest server, and a region filter when Server Info shows regions"
							></toggle>
							<choice
								label="Preview Videos"
								path="previewVideos"
								desc="How trailers on game pages behave"
							>
								<option value="paused">Don't autoplay</option>
								<option value="autoplay">Autoplay</option>
								<option value="hidden">Hide</option>
							</choice>
							<toggle
								label="Highlight Owned Badges"
								path="showBadgeOwned"
								desc="Marks badges you already have"
							></toggle>
							<toggle
								label="Compact Badge Stats"
								path="compactBadgeStats"
								desc="Shows badge stats in less space"
							></toggle>
						</page>

						<page
							name="itemdetails"
							label="Item Pages"
							icon="tag"
							path="itemdetails"
							toggle
							master="Item page features"
						>
							<toggle
								label="Show Sales"
								path="showSales"
								desc="Shows how many times an item has sold"
							></toggle>
							<toggle
								label="Show Created and Updated"
								path="showCreatedAndUpdated"
								desc="Shows when an item was created and last updated"
							></toggle>
							<toggle
								label="Exact Favorite Count"
								path="exactCounts"
								desc="Shows the exact number of favorites"
							></toggle>
							<toggle
								label="Explorer Button"
								path="explorerButton"
								desc="Adds a button to look inside models and packages"
							></toggle>
							<toggle
								label="Download Button"
								path="downloadButton"
								desc="Adds a button to download the item"
							></toggle>
							<toggle
								label="Content Button"
								path="contentButton"
								desc="Adds a button to open an item's template or texture"
							></toggle>

							<heading>Previewer</heading>
							<toggle
								label="Item Previewer"
								path="itemPreviewer"
								desc="Shows the item on your avatar in 3D"
							></toggle>
							<choice
								label="Open Automatically"
								path="itemPreviewerMode"
								require="itemPreviewer"
								desc="When the previewer opens by itself"
							>
								<option value="never">Never</option>
								<option value="animations">For animations</option>
								<option value="always">Always</option>
							</choice>
							<toggle
								label="Hover Previewer"
								path="general.hoverPreview"
								mode="general.hoverPreviewMode"
								require="true"
								desc="Previews items when you hover them"
							></toggle>
							<toggle
								label="Layered Clothing"
								path="general.previewLayeredClothing"
								require="true"
								desc="Fits layered clothing to your avatar in previews"
							></toggle>
						</page>

						<page
							name="avatar"
							label="Avatar"
							icon="person-standing"
							path="avatar"
							toggle
							master="Avatar editor features"
						>
							<toggle
								label="Remove Accessory Limits"
								path="removeAccessoryLimits"
								desc="Lets you wear more accessories at once"
							></toggle>
							<toggle
								label="Remove Layered Clothing Limits"
								path="removeLayeredLimits"
								require="removeAccessoryLimits"
								desc="Lets you wear more layered clothing at once"
							></toggle>
							<toggle
								label="Full Range Body Colors"
								path="fullRangeBodyColors"
								desc="Lets you pick any body color"
							></toggle>
							<toggle
								label="Skip R6 Switch Warning"
								path="ignoreR6Warning"
								desc="Switches to R6 without asking first"
							></toggle>
						</page>

						<page
							name="inventory"
							label="Inventory"
							icon="backpack"
							path="inventory"
							toggle
							master="Inventory features"
						>
							<toggle
								label="Inventory Tools"
								path="inventoryTools"
								desc="Lets you remove several items at once"
							></toggle>
						</page>

						<page
							name="catalog"
							label="Marketplace"
							icon="shopping-basket"
							path="catalog"
							toggle
							master="Marketplace features"
						>
							<toggle
								label="Show Owned Items"
								path="showOwnedAssets"
								desc="Marks items you already own"
							></toggle>
						</page>

						<page
							name="messages"
							label="Messages"
							icon="envelope"
							path="messages"
							toggle
							master="Inbox features"
						>
							<toggle
								label="Mark All as Read"
								path="markAllAsRead"
								desc="Adds a button to mark all messages as read"
							></toggle>
							<toggle
								label="Jump to Page"
								path="pageJump"
								desc="Lets you jump straight to a page"
							></toggle>
						</page>

						<page
							name="groups"
							label="Communities"
							icon="three-people"
							path="groups"
							toggle
							master="Community page features"
						>
							<toggle
								label="Modify Layout"
								path="modifyLayout"
								desc="Rearranges the community page and adds a payouts tab"
							></toggle>
							<toggle
								label="Exact Member Counts"
								path="exactCounts"
								desc="Shows exact member counts on community pages"
							></toggle>
						</page>

						<page
							name="create"
							label="Create"
							icon="pencil-square"
							path="create"
							toggle
							master="Creator Hub features"
						>
							<toggle
								label="Downloadable Version History"
								path="downloadVersion"
								desc="Lets you download older versions of your places and assets"
							></toggle>
							<toggle
								label="Modify Asset Options"
								path="assetOptions"
								desc="Adds extra links to your creations' menus"
							></toggle>
						</page>

						<page name="advanced" label="Advanced" icon="nine-dots-grid">
							<heading>Unlisted Settings</heading>
							<div id="btr-settings-wip" class="btr-setting-card"></div>
							<heading>Roblox Experiments</heading>
							<div class="btr-exp-toolbar">
								<label class="btr-settings-search btr-exp-filter">
									<span
										class="icon icon-regular-magnifying-glass"
										aria-hidden="true"
									></span>
									<input
										type="search"
										placeholder="Filter experiments"
										spellcheck="false"
										autocomplete="off"
									/>
								</label>
								<button type="button" id="btr-exp-reset" class="btr-settings-button">
									Reset all
								</button>
							</div>
							<p class="btr-exp-intro">
								Roblox sends some of these for its apps only, so the website never reads them.
								Those are greyed out, and changing them does nothing here. Most changes apply
								after a reload.
							</p>
							<p class="btr-exp-note"></p>
							<div id="btr-settings-experiments"></div>
							<heading>Reset</heading>
							<div class="btr-setting-card">
								<div class="btr-setting-row" data-search="reset default all">
									<div class="btr-setting-text">
										<span class="btr-setting-label">Reset All Settings</span>
										<span class="btr-setting-desc"
											>Puts every setting back to its default</span
										>
									</div>
									<button
										type="button"
										id="btr-reset-settings"
										class="btr-settings-button btr-settings-button-alert"
									>
										Reset
									</button>
								</div>
							</div>
						</page>

						<div class="btr-settings-empty" hidden>No settings match your search.</div>
					</div>

					<div class="btr-settings-reload" hidden>
						<span>Some changes apply after a reload.</span>
						<button type="button" class="btr-settings-button btr-settings-button-emphasis">
							Reload
						</button>
					</div>
				</div>
			</div>
		</div>`

		const body: HTMLElement = this.settingsDiv.$req(".btr-settings-body")

		for (const [text, failed] of [
			["Settings failed to load, so changes may not save.", SETTINGS.loadError],
			[SHARED_DATA.syncLoadError, SHARED_DATA.syncLoadError],
		]) {
			if (failed) {
				body.prepend(html`<div class="btr-settings-alert">${text}</div>`)
			}
		}

		// Closing

		this.settingsDiv.$on("click", (ev: MouseEvent) => {
			if (ev.target === this.settingsDiv) {
				this.toggle(false)
			}
		})

		// Real key presses only: the account menu item closes Roblox's menu with a
		// synthetic Escape, which would take the panel down with it.
		document.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Escape" && ev.isTrusted && this.visible && !ev.defaultPrevented) {
				this.toggle(false)
			}
		})

		// Rows

		let inputCounter = 0
		const nextId = () => `btr-settings-input-${inputCounter++}`

		const settingsDone: Record<string, boolean> = {}

		const joinPaths = (group: string, path: string) =>
			!group || path.includes(".") ? path : `${group}.${path}`

		/** A setting's dependency, as a getter, or null when there is none. */
		const requirement = (groupPath: string, attr: string | null) => {
			const requireAttr = attr ?? "enabled"

			if (requireAttr === "true" || requireAttr === "false") {
				return null
			}

			const path = joinPaths(groupPath, requireAttr.replace(/^!/, ""))

			if (!SETTINGS.hasSetting(path)) {
				return null
			}

			const invert = requireAttr.startsWith("!")
			return { path, get: () => !!SETTINGS.get(path) !== invert }
		}

		const makeRow = (labelText: string, descText: string | null, id?: string) => {
			const row = html`<div class="btr-setting-row">
				<label class="btr-setting-text">
					<span class="btr-setting-label">${labelText}</span>
				</label>
			</div>`

			if (id) {
				row.$req("label").setAttribute("for", id)
			}

			if (descText) {
				row.$req(".btr-setting-text").append(html`<span class="btr-setting-desc">${descText}</span>`)
			}

			return row
		}

		const makeSwitch = (id: string) => {
			const wrap = html`<span class="btr-setting-switch">
				<input type="checkbox" role="switch" />
				<span class="btr-setting-switch-track" aria-hidden="true"
					><span class="btr-setting-switch-knob"></span
				></span>
			</span>`

			const input = wrap.$req<HTMLInputElement>("input")
			input.id = id

			return { wrap, input }
		}

		const makeReset = (path: string) =>
			html<HTMLButtonElement>`<button type="button" class="btr-setting-reset" path=${path}>
				Reset
			</button>`

		/** Disables a row while what it depends on is off. */
		const followRequirement = (
			row: HTMLElement,
			control: HTMLElement,
			req: ReturnType<typeof requirement>,
		) => {
			if (!req) {
				return
			}

			const update = () => {
				const on = req.get()
				row.classList.toggle("btr-setting-disabled", !on)
				control.toggleAttribute("disabled", !on)
			}

			SETTINGS.onChange(req.path, update)
			update()
		}

		const buildToggle = (elem: HTMLElement, groupPath: string, pageToggle: string | null) => {
			const attr = elem.getAttribute("path")!
			const path = joinPaths(groupPath, attr.replace(/^!/, ""))
			const invert = attr.startsWith("!")
			settingsDone[path] = true

			const id = nextId()
			const row = makeRow(elem.getAttribute("label") ?? path, elem.getAttribute("desc"), id)
			const { wrap, input } = makeSwitch(id)

			if (!SETTINGS.hasSetting(path)) {
				row.$req(".btr-setting-label").textContent += " (bad setting)"
				input.disabled = true
				row.append(wrap)
				return row
			}

			row.dataset.path = path
			row.append(makeReset(path), wrap)

			// A mode is the live half of a feature that otherwise needs a reload,
			// so the one switch sets both and reads as on only when both are.
			const mode = elem.getAttribute("mode")

			if (mode) {
				settingsDone[mode] = true
			}

			input.$on("change", () => {
				SETTINGS.set(path, input.checked !== invert)

				if (mode) {
					SETTINGS.set(mode, input.checked ? "always" : "never")
				}
			})

			const update = () => {
				input.checked = !!SETTINGS.get(path) !== invert && (!mode || SETTINGS.get(mode) !== "never")
			}

			SETTINGS.onChange(path, update)
			if (mode) {
				SETTINGS.onChange(mode, update)
			}
			update()

			const reqAttr = elem.getAttribute("require")
			const req = requirement(groupPath, reqAttr)

			// Indented under the setting it depends on, unless that is just the
			// page's own switch.
			if (req && req.path !== pageToggle) {
				row.classList.add("btr-setting-child")
			}

			followRequirement(row, input, req)
			return row
		}

		const buildChoice = (elem: HTMLElement, groupPath: string, pageToggle: string | null) => {
			const path = joinPaths(groupPath, elem.getAttribute("path")!)
			settingsDone[path] = true

			const id = nextId()
			const row = makeRow(elem.getAttribute("label") ?? path, elem.getAttribute("desc"), id)
			const select = html<HTMLSelectElement>`<select></select>`
			select.id = id
			select.append(...elem.querySelectorAll("option"))

			const wrap = html`<span class="btr-select"></span>`
			wrap.append(select)

			row.dataset.path = path
			row.append(makeReset(path), wrap)

			select.$on("change", () => SETTINGS.set(path, select.value))

			const update = () => {
				select.value = SETTINGS.get(path)
			}

			SETTINGS.onChange(path, update)
			update()

			const req = requirement(groupPath, elem.getAttribute("require"))

			if (req && req.path !== pageToggle) {
				row.classList.add("btr-setting-child")
			}

			followRequirement(row, select, req)
			return row
		}

		// Pages

		this.contentDivs = {}
		const tabs = this.settingsDiv.$req(".btr-settings-tabs")

		for (const pageElem of this.settingsDiv.$findAll("page")) {
			const name = pageElem.getAttribute("name")!
			const label = pageElem.getAttribute("label") ?? name
			const groupPath = pageElem.getAttribute("path") ?? ""
			const pageToggle = pageElem.hasAttribute("toggle") ? joinPaths(groupPath, "enabled") : null

			const page = html`<section class="btr-settings-page" role="tabpanel">
				<h3 class="btr-settings-page-title">${label}</h3>
			</section>`
			page.dataset.name = name
			page.dataset.label = label

			// Consecutive rows share a card; a heading starts a new one.
			let card: HTMLElement | null = null
			const cardFor = () => {
				if (!card) {
					card = html`<div class="btr-setting-card"></div>`
					page.append(card)
				}
				return card
			}

			if (pageToggle) {
				settingsDone[pageToggle] = true

				const id = nextId()
				const row = makeRow(
					pageElem.getAttribute("master") ?? `${label} features`,
					pageElem.getAttribute("desc"),
					id,
				)
				const { wrap, input } = makeSwitch(id)

				row.classList.add("btr-setting-master")
				row.dataset.path = pageToggle
				row.append(makeReset(pageToggle), wrap)

				input.$on("change", () => SETTINGS.set(pageToggle, input.checked))

				const update = () => {
					input.checked = !!SETTINGS.get(pageToggle)
					page.classList.toggle("btr-page-disabled", !input.checked)
				}

				SETTINGS.onChange(pageToggle, update)
				update()

				page.append(html`<div class="btr-setting-card btr-setting-card-master"></div>`)
				page.lastElementChild!.append(row)
			}

			for (const child of [...pageElem.children] as HTMLElement[]) {
				const tag = child.tagName.toLowerCase()

				if (tag === "heading") {
					page.append(html`<h4 class="btr-setting-heading">${child.textContent ?? ""}</h4>`)
					card = null
				} else if (tag === "toggle") {
					cardFor().append(buildToggle(child, groupPath, pageToggle))
				} else if (tag === "choice") {
					cardFor().append(buildChoice(child, groupPath, pageToggle))
				} else if (child.classList.contains("btr-setting-row")) {
					cardFor().append(child)
				} else {
					page.append(child)
					card = null
				}
			}

			pageElem.replaceWith(page)
			this.contentDivs[name] = page

			const tab = html<HTMLButtonElement>`<button type="button" class="btr-settings-tab" role="tab">
				<span class="icon" aria-hidden="true"></span>
				<span class="btr-settings-tab-label">${label}</span>
			</button>`
			tab.dataset.page = name
			tab.firstElementChild!.classList.add(`icon-regular-${pageElem.getAttribute("icon") ?? "gear"}`)
			tab.$on("click", () => this.switchContent(name))
			tabs.append(tab)
		}

		// Navigation buttons, which keep their state in navigation.elements
		// rather than in a setting each.
		{
			const lists: Record<string, HTMLElement> = {}
			for (const list of this.settingsDiv.$findAll(".btr-settings-nav-list")) {
				const card = html`<div class="btr-setting-card"></div>`
				list.replaceWith(card)
				lists[list.dataset.kind] = card
			}

			const onUpdate: Array<() => void> = []

			const addRow = (element: any, parent: HTMLElement, child: boolean) => {
				const id = nextId()
				const row = makeRow(element.label || element.name, null, id)
				const { wrap, input } = makeSwitch(id)
				const reset = html<HTMLButtonElement>`<button type="button" class="btr-setting-reset">
					Reset
				</button>`

				row.classList.toggle("btr-setting-child", child)
				row.append(reset, wrap)
				parent.append(row)

				input.$on("change", () => element.setEnabled(input.checked))
				reset.$on("click", () => element.setEnabled(null))

				onUpdate.push(() => {
					input.checked = element.enabled
					reset.classList.toggle("btr-setting-reset-shown", !element.isDefault)
				})

				return { row, input }
			}

			for (const element of Object.values(Navigation.elements) as any[]) {
				if (element.parent) {
					continue
				}

				const parent = element.name.startsWith("header") ? lists.header : lists.sidebar
				addRow(element, parent, false)

				for (const setting of Object.values(element.settings ?? {}) as any[]) {
					const sub = addRow(setting, parent, true)

					onUpdate.push(() => {
						sub.row.classList.toggle("btr-setting-disabled", !element.enabled)
						sub.input.disabled = !element.enabled
					})
				}
			}

			const update = () => {
				for (const fn of onUpdate) {
					fn()
				}
			}

			SETTINGS.onChange("navigation.elements", update)
			update()
		}

		// Home rows, listed as Home has shown them. A switch per row, kept in
		// home.hiddenRows as the topic ids to hide.
		{
			const placeholder = this.settingsDiv.$req(".btr-settings-home-rows")
			const card = html`<div class="btr-setting-card"></div>`
			placeholder.replaceWith(card)

			const known = btrLocalStorage.getItem<Record<string, any>>(HOME_ROWS_KEY) ?? {}

			const getHidden = (): string[] => {
				try {
					const list = JSON.parse(SETTINGS.get("home.hiddenRows") || "[]")
					return Array.isArray(list) ? list.map(String) : []
				} catch {
					return []
				}
			}

			const rows = Object.entries(known)

			if (!rows.length) {
				card.append(
					html`<div class="btr-setting-row">
						<div class="btr-setting-text">
							<span class="btr-setting-desc">Open Home once and its rows show up here</span>
						</div>
					</div>`,
				)
			}

			for (const [id, row] of rows) {
				const inputId = nextId()
				const elem = makeRow(`Show ${row.title}`, row.subtitle || null, inputId)
				const { wrap, input } = makeSwitch(inputId)

				elem.dataset.search = "home row hide"
				elem.append(wrap)
				card.append(elem)

				input.$on("change", () => {
					const hidden = new Set(getHidden())

					if (input.checked) {
						hidden.delete(id)
					} else {
						hidden.add(id)
					}

					SETTINGS.set("home.hiddenRows", hidden.size ? JSON.stringify([...hidden]) : "")
				})

				const update = () => {
					input.checked = !getHidden().includes(id)
				}

				SETTINGS.onChange("home.hiddenRows", update)
				update()
			}

			settingsDone["home.hiddenRows"] = true
		}

		// Robux to cash
		{
			const currencySelect = this.settingsDiv.$req("#btr-robuxToCash-currency") as HTMLSelectElement
			const rateSelect = this.settingsDiv.$req("#btr-robuxToCash-rate") as HTMLSelectElement

			const currencies: any[] = Object.values(RobuxToCash.Currencies)

			for (const currency of currencies.filter((x) => !x.usdRate)) {
				currencySelect.append(html<HTMLOptionElement>`<option>${currency.name}</option>`)
			}

			for (const currency of currencies
				.filter((x) => x.usdRate)
				.toSorted((a, b) => ((a.name ?? "") < (b.name ?? "") ? -1 : 1))) {
				currencySelect.append(
					html<HTMLOptionElement>`<option
						title="Rates are estimations based on USD-${currency.name} exchange rate on ${RobuxToCash.UpdateDate}"
						value="${currency.name}"
					>
						${currency.name}*
					</option>`,
				)
			}

			const setRate = () => {
				SETTINGS.set("general.robuxToUSDRate", rateSelect.value)
			}

			currencySelect.$on("change", () => {
				SETTINGS.set(
					"general.robuxToUSDRate",
					(RobuxToCash.OptionLists as Record<string, any>)[currencySelect.value][0].name,
				)
			})

			rateSelect.$on("change", setRate)

			const updateRate = () => {
				const name = RobuxToCash.getSelectedOption().currency.name
				currencySelect.value = name

				rateSelect.replaceChildren()
				let selected = false

				for (const option of (RobuxToCash.OptionLists as Record<string, any>)[name]) {
					let fullText = ""

					if (option.name === "none") {
						fullText = "No currency selected"
					} else {
						const display =
							option.label ??
							(option.name.includes("Subscription")
								? "Subscription"
								: option.name.includes("Premium")
									? "Premium"
									: "Regular")

						const rateText = option.currency.usdRate
							? `${option.currency.symbol}${(option.cash / 100).toFixed(option.currency.numFractions)} ≈ US$${(option.usdCash / 100).toFixed(2)} = R$${option.robux}`
							: `${option.currency.symbol}${(option.cash / 100).toFixed(option.currency.numFractions)} = R$${option.robux}`

						fullText = `${display} (${rateText})`
					}

					rateSelect.append(
						html<HTMLOptionElement>`<option value="${option.name}">${fullText}</option>`,
					)

					if (option.name === SETTINGS.get("general.robuxToUSDRate")) {
						selected = true
					}
				}

				if (selected) {
					rateSelect.value = SETTINGS.get("general.robuxToUSDRate")
				} else {
					rateSelect.value = rateSelect.options[0].value
					setRate()
				}

				rateSelect.disabled = name === "None"
			}

			SETTINGS.onChange("general.robuxToUSDRate", updateRate)
			updateRate()
		}

		// Reset all, which asks for a second click within three seconds.
		{
			const resetButton = this.settingsDiv.$req("#btr-reset-settings") as HTMLButtonElement
			let timer: ReturnType<typeof setInterval> | null = null
			let left = 0

			const stop = () => {
				if (timer !== null) {
					clearInterval(timer)
				}
				timer = null
				resetButton.textContent = "Reset"
				resetButton.classList.remove("btr-settings-button-armed")
			}

			resetButton.$on("click", () => {
				if (timer === null) {
					left = 3
					resetButton.textContent = `Confirm (${left})`
					resetButton.classList.add("btr-settings-button-armed")

					timer = setInterval(() => {
						if (--left > 0) {
							resetButton.textContent = `Confirm (${left})`
						} else {
							stop()
						}
					}, 1e3)
					return
				}

				stop()
				SETTINGS.resetToDefault()
			})
		}

		// Settings with no row of their own, listed so they can still be changed.
		{
			const wip = this.settingsDiv.$req("#btr-settings-wip")

			for (const [groupPath, settingsGroup] of Object.entries(SETTINGS.loadedSettings) as [
				string,
				any,
			][]) {
				for (const [settingName, settingValueInfo] of Object.entries(settingsGroup) as [
					string,
					any,
				][]) {
					const defaultValueInfo = (DEFAULT_SETTINGS as Record<string, any>)[groupPath][settingName]
					const path = `${groupPath}.${settingName}`

					if (settingsDone[path] || defaultValueInfo.hidden) {
						continue
					}

					const value = settingValueInfo.value
					const id = nextId()
					const row = makeRow(path, null, id)
					row.dataset.path = path

					if (typeof value === "boolean") {
						const { wrap, input } = makeSwitch(id)
						row.append(makeReset(path), wrap)

						input.$on("change", () => SETTINGS.set(path, input.checked))
						const update = () => {
							input.checked = !!SETTINGS.get(path)
						}
						SETTINGS.onChange(path, update)
						update()
					} else if (typeof value === "string" && defaultValueInfo.validValues) {
						const select = html<HTMLSelectElement>`<select></select>`
						select.id = id

						for (const valid of defaultValueInfo.validValues) {
							select.append(html<HTMLOptionElement>`<option value="${valid}">${valid}</option>`)
						}

						const wrap = html`<span class="btr-select"></span>`
						wrap.append(select)
						row.append(makeReset(path), wrap)

						select.$on("change", () => SETTINGS.set(path, select.value))
						const update = () => {
							select.value = SETTINGS.get(path)
						}
						SETTINGS.onChange(path, update)
						update()
					} else {
						row.$req(".btr-setting-label").textContent += ` (${typeof value})`
					}

					wip.append(row)
				}
			}

			if (!wip.children.length) {
				wip.previousElementSibling?.remove()
				wip.remove()
			}
		}

		// Reset links show only once a setting differs from its default.
		for (const btn of this.settingsDiv.$findAll(
			".btr-setting-reset[path]",
		) as NodeListOf<HTMLButtonElement>) {
			const path = btn.getAttribute("path")!
			btn.title = "Reset to default"

			const update = () => {
				btn.classList.toggle("btr-setting-reset-shown", !SETTINGS.getIsDefault(path))
			}

			btn.$on("click", (ev: Event) => {
				ev.preventDefault()
				SETTINGS.reset(path)
			})

			SETTINGS.onChange(path, update)
			update()
		}

		// Search, over every row's label and description and its page's name.
		{
			const input = this.settingsDiv.$req(".btr-settings-search input") as HTMLInputElement
			const empty = this.settingsDiv.$req(".btr-settings-empty")
			const main = this.settingsDiv.$req(".btr-settings")

			const clear = this.settingsDiv.$req(".btr-settings-search-clear")

			const run = () => {
				clear.hidden = !input.value
				const words = input.value.toLowerCase().split(/\s+/).filter(Boolean)
				this.searching = words.length > 0
				main.classList.toggle("btr-settings-searching", this.searching)

				let any = false

				for (const page of Object.values(this.contentDivs) as HTMLElement[]) {
					let pageHits = 0

					for (const row of page.$findAll<HTMLElement>(".btr-setting-row")) {
						const text =
							`${row.textContent} ${row.dataset.search ?? ""} ${row.dataset.path ?? ""} ${page.dataset.label}`.toLowerCase()
						const hit = !this.searching || words.every((word) => text.includes(word))

						row.classList.toggle("btr-setting-filtered", !hit)
						pageHits += hit ? 1 : 0
					}

					for (const card of page.$findAll<HTMLElement>(".btr-setting-card")) {
						card.classList.toggle(
							"btr-setting-filtered",
							this.searching &&
								!card.querySelector(".btr-setting-row:not(.btr-setting-filtered)"),
						)
					}

					page.classList.toggle("btr-page-hit", this.searching && pageHits > 0)
					any ||= pageHits > 0
				}

				empty.hidden = !this.searching || any
				this.settingsDiv.$req(".btr-settings-title").textContent = this.searching
					? "Search"
					: (this.contentDivs[this.currentContent]?.dataset.label ?? "")
			}

			input.$on("input", run)

			clear.$on("click", (ev: Event) => {
				ev.preventDefault()
				input.value = ""
				run()
				input.focus()
			})

			this.clearSearch = () => {
				if (input.value) {
					input.value = ""
					run()
				}
			}
		}

		// The reload prompt. Settings that already re-read their value apply
		// live, so only the rest ask for one, and only while they differ from
		// what the page booted with. Anything listed as live must genuinely
		// handle being switched off again, not just on.
		{
			const APPLIES_LIVE = new Set([
				"general.theme",
				"general.enableContextMenus",
				"general.robuxToUSDRate",
				"general.hideSponsored",
				"navigation.noHamburger",
				"navigation.elements",
				"messages.markAllAsRead",
				"messages.pageJump",
				"general.hideChat",
				"general.smallChatButton",
				"general.voiceChatStatus",
				"general.hoverPreviewMode",
				"itemdetails.itemPreviewer",
				"itemdetails.explorerButton",
				"itemdetails.downloadButton",
				"itemdetails.contentButton",
			])

			const bar: HTMLElement = this.settingsDiv.$req(".btr-settings-reload")
			const bootValues = new Map<string, any>()

			// Objects never compare equal by identity, so values are compared
			// serialised, which keeps the revert check working for them.
			const stamp = (value: any) => (value instanceof Object ? JSON.stringify(value) : value)

			const collect = (group: any, prefix: string) => {
				for (const [key, value] of Object.entries(group) as [string, any][]) {
					if (key.startsWith("_") || !(value instanceof Object)) {
						continue
					}

					if ("value" in value) {
						bootValues.set(prefix + key, stamp(value.value))
					} else {
						collect(value, prefix + key + ".")
					}
				}
			}

			collect(SETTINGS.loadedSettings, "")

			const dirty = new Set<string>()

			bar.$req("button").$on("click", () => location.reload())

			SETTINGS.onChange((value: any, _isDefault: boolean, settingPath: string) => {
				if (!settingPath || APPLIES_LIVE.has(settingPath)) {
					return
				}

				if (bootValues.has(settingPath) && bootValues.get(settingPath) === stamp(value)) {
					dirty.delete(settingPath)
				} else {
					dirty.add(settingPath)
				}

				bar.hidden = dirty.size === 0
			})
		}

		// Dropdowns, in the style of Roblox's own menus. The native select stays,
		// hidden, as the one place the value lives, so everything that reads or
		// sets it keeps working; the button and menu only mirror it.
		{
			const modal: HTMLElement = this.settingsDiv
			const body: HTMLElement = modal.$req(".btr-settings-body")

			const menu = html`<div class="btr-dropdown-menu" role="listbox" tabindex="-1" hidden></div>`
			modal.append(menu)

			let owner: HTMLSelectElement | null = null
			let ownerButton: HTMLButtonElement | null = null
			let active = -1
			let closeTimer: ReturnType<typeof setTimeout> | undefined

			const options = () => [...menu.children] as HTMLElement[]

			const setActive = (index: number) => {
				const items = options()
				active = Math.max(0, Math.min(items.length - 1, index))

				items.forEach((item, i) => item.classList.toggle("btr-dropdown-active", i === active))
				items[active]?.scrollIntoView({ block: "nearest" })
			}

			const close = (focusButton = false) => {
				if (!owner) {
					return
				}

				ownerButton!.setAttribute("aria-expanded", "false")

				if (focusButton) {
					ownerButton!.focus()
				}

				owner = null
				ownerButton = null
				menu.classList.remove("btr-dropdown-open")

				clearTimeout(closeTimer)
				closeTimer = setTimeout(() => {
					if (!owner) {
						menu.hidden = true
					}
				}, 150)
			}

			const choose = (index: number) => {
				const select = owner
				const item = options()[index]

				close(true)

				if (select && item && select.value !== item.dataset.value) {
					select.value = item.dataset.value!
					select.dispatchEvent(new Event("change"))
				}
			}

			const open = (select: HTMLSelectElement, button: HTMLButtonElement) => {
				clearTimeout(closeTimer)
				owner = select
				ownerButton = button
				button.setAttribute("aria-expanded", "true")

				menu.replaceChildren()

				for (const option of select.options) {
					const item = html`<div class="btr-dropdown-option" role="option">
						<span class="btr-dropdown-option-label">${option.textContent?.trim() ?? ""}</span>
					</div>`

					item.dataset.value = option.value
					item.setAttribute("aria-selected", String(option.selected))
					item.title = option.title || option.textContent?.trim() || ""

					item.$on("pointermove", () => setActive(options().indexOf(item)))
					item.$on("click", () => choose(options().indexOf(item)))
					menu.append(item)
				}

				// Below the button, or above when that has more room, and never
				// narrower than the button itself.
				const rect = button.getBoundingClientRect()
				const below = innerHeight - rect.bottom - 16
				const above = rect.top - 16
				const up = below < 240 && above > below

				menu.hidden = false
				menu.style.minWidth = `${rect.width}px`
				menu.style.maxHeight = `${Math.min(320, up ? above : below)}px`
				menu.style.left = `${Math.min(rect.left, innerWidth - menu.offsetWidth - 16)}px`
				menu.style.top = up ? "" : `${rect.bottom + 4}px`
				menu.style.bottom = up ? `${innerHeight - rect.top + 4}px` : ""
				menu.classList.toggle("btr-dropdown-up", up)

				setActive(select.selectedIndex)
				requestAnimationFrame(() => {
					if (owner === select) {
						menu.classList.add("btr-dropdown-open")
					}
				})
			}

			// Capture, so Escape closes the menu before it can close the dialog.
			document.addEventListener(
				"keydown",
				(ev: KeyboardEvent) => {
					if (!owner) {
						return
					}

					const count = options().length
					let handled = true

					switch (ev.key) {
						case "ArrowDown":
							setActive(active + 1)
							break
						case "ArrowUp":
							setActive(active - 1)
							break
						case "Home":
							setActive(0)
							break
						case "End":
							setActive(count - 1)
							break
						case "Enter":
						case " ":
							choose(active)
							break
						case "Escape":
							close(true)
							break
						case "Tab":
							close()
							handled = false
							break
						default: {
							// Type a letter to jump to the next option starting with it.
							const key = ev.key.length === 1 ? ev.key.toLowerCase() : ""
							const items = options()
							const next = key
								? [...items.slice(active + 1), ...items.slice(0, active + 1)].find((item) =>
										item.textContent?.trim().toLowerCase().startsWith(key),
									)
								: null

							if (next) {
								setActive(items.indexOf(next))
							} else {
								handled = false
							}
						}
					}

					if (handled) {
						ev.preventDefault()
						ev.stopPropagation()
					}
				},
				true,
			)

			document.addEventListener(
				"pointerdown",
				(ev: Event) => {
					if (
						owner &&
						!menu.contains(ev.target as Node) &&
						!ownerButton!.contains(ev.target as Node)
					) {
						close()
					}
				},
				true,
			)

			body.addEventListener("scroll", () => close(), { passive: true })
			window.addEventListener("resize", () => close())

			const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!

			const upgradeSelect = (select: HTMLSelectElement) => {
				const button = html<HTMLButtonElement>`<button
					type="button"
					class="btr-dropdown"
					aria-haspopup="listbox"
					aria-expanded="false"
				>
					<span class="btr-dropdown-label"></span>
					<span class="btr-dropdown-chevron" aria-hidden="true"></span>
				</button>`

				if (select.id) {
					button.id = select.id
					select.removeAttribute("id")
				}

				const ariaLabel = select.getAttribute("aria-label")
				if (ariaLabel) {
					button.setAttribute("aria-label", ariaLabel)
				}

				select.tabIndex = -1
				select.after(button)

				const refresh = () => {
					const selected = select.selectedOptions[0]
					button.$req(".btr-dropdown-label").textContent = selected?.textContent?.trim() ?? ""
					button.title = selected?.title || selected?.textContent?.trim() || ""
					button.disabled = select.disabled
				}

				// The rest of this file sets the value directly, which fires no
				// event, so the setter itself tells the button.
				Object.defineProperty(select, "value", {
					configurable: true,
					get: () => nativeValue.get!.call(select),
					set: (value) => {
						nativeValue.set!.call(select, value)
						refresh()
					},
				})

				new MutationObserver(refresh).observe(select, {
					attributes: true,
					attributeFilter: ["disabled"],
					childList: true,
					subtree: true,
				})

				button.$on("click", () => (owner === select ? close() : open(select, button)))
				button.$on("keydown", (ev: KeyboardEvent) => {
					if (!owner && ["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) {
						ev.preventDefault()
						open(select, button)
					}
				})

				refresh()
			}

			for (const select of modal.$findAll<HTMLSelectElement>(".btr-select select")) {
				upgradeSelect(select)
			}

			this.upgradeSelect = upgradeSelect
		}

		// Experiment editor: a filter over experiments and parameters, and a
		// reset for all of them.
		{
			const filter = this.settingsDiv.$req(".btr-exp-filter input") as HTMLInputElement

			filter.$on("input", () => {
				const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean)

				for (const group of Object.values(this.experiments) as any[]) {
					const groupHit = words.every((word) => group.name.toLowerCase().includes(word))
					let shown = 0

					for (const entry of Object.values(group.entries) as any[]) {
						const hit = groupHit || words.every((word) => entry.key.toLowerCase().includes(word))
						entry.row.hidden = !hit
						shown += hit ? 1 : 0
					}

					group.details.hidden = shown === 0
				}
			})

			this.settingsDiv.$req("#btr-exp-reset").$on("click", () => this.resetExperiments())
		}

		this.robloxExperimentsChanged()
	},

	experiments: {},

	getSavedExperiments() {
		const data = SETTINGS.get("general.experiments")
		let saved

		try {
			saved = JSON.parse(data || "{}")
		} catch (ex) {
			console.error(ex)
		}

		return saved instanceof Object && !Array.isArray(saved) ? saved : {}
	},

	experimentHints: null as Record<string, ExperimentHint> | null,
	loadingHints: false,

	/** Reads Roblox's scripts for what each parameter accepts, once, when Advanced opens. */
	loadExperimentHints() {
		if (this.experimentHints || this.loadingHints || !this.settingsDiv) {
			return
		}

		this.loadingHints = true
		const note: HTMLElement = this.settingsDiv.$req(".btr-exp-note")
		note.textContent = "Reading Roblox's scripts for the values each parameter accepts..."

		const keys = Object.values(this.experiments).flatMap((group: any) => Object.keys(group.entries))

		discoverExperimentHints(keys).then(
			async (hints) => {
				// Parameters that turned up while the scripts were being read are
				// looked up too; the scripts are cached by now, so this is quick.
				const missing = Object.values(this.experiments)
					.flatMap((group: any) => Object.keys(group.entries))
					.filter((key) => !(key in hints))

				if (missing.length) {
					Object.assign(hints, await discoverExperimentHints(missing))
				}

				this.experimentHints = hints
				note.textContent = ""

				for (const group of Object.values(this.experiments) as any[]) {
					for (const entry of Object.values(group.entries) as any[]) {
						entry.render()
					}
					group.sort()
				}
			},
			() => {
				this.loadingHints = false
				note.textContent = "Couldn't read Roblox's scripts, so only typed values are offered"
			},
		)
	},

	robloxExperimentsChanged() {
		const root: HTMLElement | null = this.settingsDiv?.$find("#btr-settings-experiments")

		if (!root) {
			return
		}

		const format = (json: string) => {
			try {
				const value = JSON.parse(json)
				return typeof value === "string" ? value : String(value)
			} catch {
				return json
			}
		}

		const save = (experiment: string, key: string, value: string) => {
			const data = this.getSavedExperiments()

			// Picking what is already saved is not a change.
			if ((data[experiment]?.[key] || "") === value) {
				return
			}

			injectScript.send("updateExperiment", experiment, key, value)

			if (value) {
				data[experiment] ??= {}
				data[experiment][key] = value
			} else if (data[experiment]) {
				delete data[experiment][key]

				if (Object.keys(data[experiment]).length === 0) {
					delete data[experiment]
				}
			}

			// Nothing left goes back to the default, not to "{}".
			SETTINGS.set("general.experiments", Object.keys(data).length ? JSON.stringify(data) : "")
		}

		const addGroup = (experiment: string) => {
			const details = html`<details class="btr-exp-group" open>
				<summary>
					<span class="btr-exp-title"></span>
					<span class="btr-exp-count"></span>
				</summary>
				<div class="btr-exp-rows"></div>
			</details>`

			details.$req(".btr-exp-title").textContent = experiment
			details.title = experiment

			const group = {
				name: experiment,
				details,
				rows: details.$req(".btr-exp-rows"),
				entries: {} as Record<string, any>,

				/** Parameters the site reads first, then the rest, dimmed. */
				sort() {
					const entries = Object.values(this.entries).toSorted(
						(a: any, b: any) => Number(a.unused) - Number(b.unused) || a.key.localeCompare(b.key),
					)

					this.rows.append(...entries.map((entry: any) => entry.row))

					const edited = entries.filter((entry: any) => entry.edited).length
					const used = entries.filter((entry: any) => !entry.unused).length

					details.$req(".btr-exp-count").textContent = edited ? `${edited} edited` : ""
					details.classList.toggle("btr-exp-unused", !!SettingsModal.experimentHints && used === 0)

					const groups = Object.values(SettingsModal.experiments).toSorted(
						(a: any, b: any) =>
							Number(a.details.classList.contains("btr-exp-unused")) -
								Number(b.details.classList.contains("btr-exp-unused")) ||
							a.name.localeCompare(b.name),
					)

					root.append(...groups.map((other: any) => other.details))
				},
			}

			this.experiments[experiment] = group
			root.append(details)
			return group
		}

		const addEntry = (group: any, key: string) => {
			const row = html`<div class="btr-exp-row">
				<span class="btr-exp-name"></span>
				<span class="btr-exp-control"></span>
			</div>`

			row.$req(".btr-exp-name").textContent = key
			row.$req(".btr-exp-name").title = key

			const entry = {
				key,
				row,
				unused: false,
				edited: false,

				render() {
					const experiment = group.name
					const hint = SettingsModal.experimentHints?.[key]
					const current = robloxExperiments[experiment]?.[key]
					const saved: string = SettingsModal.getSavedExperiments()[experiment]?.[key] || ""
					const currentJson = current === undefined ? "" : JSON.stringify(current)

					this.unused = !!hint && !hint.used
					this.edited = !!saved
					row.classList.toggle("btr-exp-unused", this.unused)
					row.classList.toggle("btr-exp-edited", this.edited)

					// Roblox's comparisons, or a boolean's two states, become a list;
					// anything else stays a typed value.
					const choices = new Set<string>(
						hint?.flag || typeof current === "boolean" ? ["true", "false"] : (hint?.values ?? []),
					)

					const slot = row.$req(".btr-exp-control")

					if (choices.size) {
						if (currentJson) {
							choices.add(currentJson)
						}
						if (saved) {
							choices.add(saved)
						}

						const select = html<HTMLSelectElement>`<select aria-label="${key}"></select>`
						const defaultOption = document.createElement("option")
						defaultOption.value = ""
						defaultOption.textContent = currentJson
							? `Default (${format(currentJson)})`
							: "Default"
						select.append(defaultOption)

						for (const choice of choices) {
							const option = document.createElement("option")
							option.value = choice
							option.textContent = format(choice)
							select.append(option)
						}

						select.value = saved
						select.$on("change", () => {
							save(experiment, key, select.value)
							entry.render()
							group.sort()
						})

						const wrap = html`<span class="btr-select"></span>`
						wrap.append(select)
						slot.replaceChildren(wrap)
						SettingsModal.upgradeSelect?.(select)
					} else {
						const input = html<HTMLInputElement>`<input
							class="btr-exp-input"
							type="text"
							spellcheck="false"
							aria-label="${key}"
						/>`

						input.value = saved
						input.placeholder = currentJson || "Not set"

						const commit = () => {
							let valid = true

							if (input.value) {
								try {
									JSON.parse(input.value)
								} catch {
									valid = false
								}
							}

							input.classList.toggle("btr-exp-invalid", !valid)

							if (valid) {
								save(experiment, key, input.value)
								entry.edited = !!input.value
								row.classList.toggle("btr-exp-edited", entry.edited)
								group.sort()
							}
						}

						input.$on("keydown", (ev: KeyboardEvent) => ev.key === "Enter" && input.blur())
						input.$on("blur", commit)
						slot.replaceChildren(input)
					}
				},
			}

			group.entries[key] = entry
			entry.render()

			// A parameter that turns up after the scripts were read is looked up on
			// its own; the scripts themselves are cached by then.
			if (this.experimentHints && !(key in this.experimentHints)) {
				void discoverExperimentHints([key]).then((hints) => {
					Object.assign(this.experimentHints!, hints)
					entry.render()
					group.sort()
				})
			}
		}

		const all: Record<string, Set<string>> = {}

		for (const source of [robloxExperiments, this.getSavedExperiments()]) {
			for (const [experiment, values] of Object.entries(source) as [string, any][]) {
				for (const key of Object.keys(values ?? {})) {
					;(all[experiment] ??= new Set()).add(key)
				}
			}
		}

		for (const [experiment, keys] of Object.entries(all)) {
			const group = this.experiments[experiment] ?? addGroup(experiment)

			for (const key of keys) {
				if (group.entries[key]) {
					group.entries[key].render()
				} else {
					addEntry(group, key)
				}
			}

			group.sort()
		}
	},

	/** Puts every experiment back to what Roblox sends. */
	resetExperiments() {
		for (const [experiment, values] of Object.entries(this.getSavedExperiments()) as [string, any][]) {
			for (const key of Object.keys(values ?? {})) {
				injectScript.send("updateExperiment", experiment, key, "")
			}
		}

		SETTINGS.set("general.experiments", "")
		this.robloxExperimentsChanged()
	},
}

/**
 * Adds "BTR Settings" to Roblox's account menu, right under its own settings
 * link. Both sites open that menu in a portal react renders on demand, so the
 * menu is found by the link rather than by its label, which is translated.
 * The item is a copy of the link so it keeps Roblox's look.
 */
export const watchSettingsMenu = (settingsLink: string): void => {
	document.$watchAll(`.foundation-web-menu:has(${settingsLink})`, (menu: HTMLElement) => {
		const link = menu.$find(settingsLink)

		if (!link || menu.$find(".btr-settings-toggle")) {
			return
		}

		const item = link.cloneNode(true) as HTMLElement
		item.removeAttribute("href")
		item.classList.add("btr-settings-toggle")

		const title =
			item.$find(".foundation-web-menu-item-title") ??
			[...item.querySelectorAll("span, div")].findLast(
				(node) => !node.children.length && node.textContent?.trim(),
			)

		if (title) {
			title.textContent = "BTR Settings"
		}

		// The menu stays open otherwise, over the settings panel. Closed a tick
		// later, as a detached item would no longer reach the toggle handler.
		item.$on("click", () => {
			setTimeout(() => {
				menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
			})
		})

		link.after(item)
	})
}
