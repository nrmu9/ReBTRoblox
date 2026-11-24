import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { btrLocalStorage } from "@/core/storage"
import { waitForRobloxResponse } from "@/feat/robloxResponses"
import { SETTINGS } from "@/feat/settings"
import { keepTrackLabel } from "@/feat/activity/trackMenu"
import { openTracked } from "@/feat/activity/open"
import { addLeaveButtons } from "@/feat/quickRemove"
import {
	formatNumber,
	loggedInUserPromise,
	modifyAngularTemplate,
	onPageLoad,
	onPageReset,
	loadPreviewer,
} from "@/pages/common"

// A count Roblox shortened, "13.5M+ Members", split into the number and the
// words after it, which stay as Roblox wrote them, translated or not.
const ROUNDED_COUNT = /^([\d.,]+[KMB]?\+?)(\s.*)$/i

// Exact member counts by community id, remembered between visits so a page
// shows them as soon as Roblox draws its rounded ones, rather than once its
// data comes in. Fresh answers replace them on every visit.
const COUNTS_KEY = "memberCounts"
const memberCounts = new Map<string, number>(
	Object.entries(btrLocalStorage.getItem<Record<string, number>>(COUNTS_KEY) ?? {}),
)
const countUpdaters = new Set<() => void>()

const learnCounts = (entries: Iterable<[string, unknown]>) => {
	for (const [id, count] of entries) {
		if (typeof count === "number" && Number.isSafeInteger(count)) {
			memberCounts.set(id, count)
		}
	}

	// Kept small: the last 200 communities seen.
	const kept = Object.fromEntries([...memberCounts].slice(-200))
	btrLocalStorage.setItem(COUNTS_KEY, kept, { expires: Date.now() + 30 * 86400e3 })

	for (const update of countUpdaters) {
		update()
	}
}

/**
 * Keeps an element showing the exact count of a community. Only a count in
 * Roblox's rounded form, or one already rewritten, is touched, so anything
 * else Roblox puts there is left alone. One watcher per element, which reads
 * whatever count is newest.
 */
const watchedCounts = new WeakSet<HTMLElement>()
const showExactCount = (element: HTMLElement, groupId: string) => {
	if (watchedCounts.has(element)) {
		return
	}

	watchedCounts.add(element)

	const apply = () => {
		const count = memberCounts.get(groupId)
		const match = ROUNDED_COUNT.exec(element.textContent?.trim() ?? "")

		if (count === undefined || !match || element.childElementCount !== 0) {
			return
		}

		const text = `${formatNumber(count)}${match[2]}`
		if (element.textContent !== text) {
			element.textContent = text
		}
	}

	new MutationObserver(apply).observe(element, { characterData: true, childList: true, subtree: true })
	countUpdaters.add(apply)
	apply()
}

/**
 * The header's count from the community itself, the list's from your groups.
 * Both are answers Roblox asks for anyway, in before it draws the counts.
 */
const showExactMemberCounts = (groupId: number) => {
	const url = `https://groups.roblox.com/v1/groups/${groupId}`

	document.$watchAll("button.radius-circle", (button: HTMLElement) => {
		showExactCount(button, String(groupId))
	})

	document.$watchAll(".groups-list-item", (item: HTMLAnchorElement) => {
		const id = item.getAttribute("href")?.match(/\/communities\/(\d+)/)?.[1]
		const label = item.$find<HTMLElement>(".text-body-medium .text-body-medium, span.text-body-medium")

		if (id && label) {
			showExactCount(label, id)
		}
	})

	waitForRobloxResponse((responseUrl) => responseUrl === url)
		.then((json) => json ?? fetch(url, { credentials: "include" }).then((res) => res.json()))
		.then((group) => learnCounts([[String(groupId), group?.memberCount]]))
		.catch(() => {})

	loggedInUserPromise
		.then(async (userId) => {
			if (userId <= 0) {
				return null
			}

			// Roblox loads your communities for its own list; that answer is read
			// rather than asked for again, and kept for the mutual marks on profiles.
			const json =
				(await waitForRobloxResponse((url) =>
					url.includes(`groups.roblox.com/v1/users/${userId}/groups/roles`),
				)) ??
				(await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`, {
					credentials: "include",
				}).then((res) => res.json()))

			if (Array.isArray(json?.data)) {
				btrLocalStorage.setItem(
					`ownCommunities-${userId}`,
					json.data.map((entry: any) => entry.group.id),
					{ expires: Date.now() + 10 * 60e3 },
				)
			}

			return json
		})
		.then((json) => {
			learnCounts(
				(json?.data ?? []).map(
					(entry: any) => [String(entry.group?.id), entry.group?.memberCount] as [string, unknown],
				),
			)
		})
		.catch(() => {})
}

pageInit.groups = () => {
	if (SETTINGS.get("general.hoverPreview")) {
		loadPreviewer().then(({ HoverPreview }) => {
			HoverPreview.register(".item-card", ".item-card-thumb-container")
		})
	}

	if (SETTINGS.get("general.quickRemove")) {
		void loggedInUserPromise.then((userId) => userId > 0 && addLeaveButtons(userId))
	}

	if (!SETTINGS.get("groups.enabled")) {
		return
	}

	// Opens the community's activity, where tracking it starts and stops.
	onPageLoad((groupIdString: string) => {
		const groupId = Number.parseInt(groupIdString, 10)

		if (!Number.isSafeInteger(groupId)) {
			return
		}

		// The header's ... menu gets the entry. Other menus on the page look the
		// same, so it goes only into one opened just after that button was pressed.
		let pressed = 0

		document.addEventListener(
			"click",
			(ev) => {
				if (
					(ev.target as Element).closest?.(
						// The button, or its narrow window copy.
						".group-profile-header .contextual-menu-actions-btn, .group-profile-header .actions-container .MuiIconButton-root",
					)
				) {
					pressed = Date.now()
				}
			},
			true,
		)

		// Watched by entry, as the list can be drawn before its entries are.
		document.$watch(
			".MuiMenu-list > li:not(.btr-track-menu-item)",
			(template: HTMLElement) => {
				const list = template.parentElement!

				if (Date.now() - pressed > 5000) {
					return
				}

				let item = list.$find<HTMLElement>(":scope > .btr-track-menu-item")

				if (!item) {
					// Roblox's own entries' look, without their ripple.
					item = document.createElement("li")
					item.className = `${template.className} btr-track-menu-item`
					item.setAttribute("role", "menuitem")
					item.tabIndex = -1
					keepTrackLabel(item, "group", groupId)

					item.$on("click", () => {
						list.closest(".MuiPopover-root")
							?.querySelector<HTMLElement>(".MuiBackdrop-root")
							?.click()
						// The page title is the name followed by - Roblox.
						openTracked(
							"group",
							groupId,
							document.title.replace(/ - Roblox$/, "") || `Community ${groupId}`,
						)
					})
				}

				// Last, after any entries drawn later.
				list.append(item)
			},
			{ continuous: true },
		)
	})

	if (SETTINGS.get("groups.exactCounts")) {
		onPageLoad((groupIdString: string) => {
			const groupId = Number.parseInt(groupIdString, 10)

			if (Number.isSafeInteger(groupId)) {
				showExactMemberCounts(groupId)
			}
		})
	}

	if (SETTINGS.get("groups.modifyLayout")) {
		injectScript.call("groupsModifyLayout")

		modifyAngularTemplate(["group-base", "group-about"], (baseTemplate, aboutTemplate) => {
			const tabs = baseTemplate.$req(".rbx-tabs-horizontal")

			// Announcements go above the tabs. Events, the shout and the wall stay
			// in the About tab where Roblox puts them.
			const announcements = aboutTemplate.$find("#group-announcements")
			if (announcements) {
				announcements.removeAttribute("ng-switch-when")
				tabs.before(announcements)
			}

			// toggle games/payouts based on custom tab
			const games = aboutTemplate.$find("group-games")
			if (games) {
				games.setAttribute("ng-show", `!btrCustomTab.name`)
			}

			const payouts = aboutTemplate.$find("group-payouts")
			if (payouts) {
				payouts.setAttribute("layout", "layout")
				payouts.setAttribute("ng-show", `btrCustomTab.name === "payouts"`)
			}

			// Community posts go below the tabs, on every tab but Posts itself.
			const discovery = aboutTemplate.$find("group-forums-discovery")
			if (discovery) {
				discovery.removeAttribute("ng-switch-when")
				discovery.setAttribute("ng-show", "layout.activeTab !== groupDetailsConstants.tabs.forums")
				tabs.parentElement!.append(discovery)
			}
		})

		// Roblox's "more" link under the description, as a pill next to the
		// member count. The link is found when clicked, as Roblox can draw it
		// again, and stays in the page so the pill can click it.
		document.$watchAll(".profile-insights-container", (insights: HTMLElement) => {
			const header = insights.closest(".group-profile-header")
			if (!header || insights.$find(".btr-more-pill")) {
				return
			}

			const pill = html<HTMLButtonElement>`<button
				type="button"
				class="flex items-center bg-surface-300 radius-circle text-caption-medium padding-x-medium padding-y-xsmall cursor-pointer profile-insight-pill-button btr-more-pill"
			>
				More
			</button>`

			pill.$on("click", (ev: Event) => {
				ev.preventDefault()
				ev.stopPropagation()
				header.$find<HTMLElement>(".description-more-btn")?.click()
			})

			insights.append(pill)
		})

		modifyAngularTemplate("group-tab", (template) => {
			const tab = template.$req(".rbx-tab")

			tab.setAttribute("btr-custom-tab", "btrCustomTab")
			tab.setAttribute(
				"ng-class",
				tab
					.getAttribute("ng-class")!
					.replace(
						/activeTab === tab/,
						"activeTab.state === tab.state && btrCustomTab.name == tab.btrCustomTab",
					),
			)
			tab.setAttribute("ng-click", "btrCustomTab.name = tab.btrCustomTab")

			// it only supports up to 5 tabs by default, so just hardcode width
			tab.setAttribute("style", "width: calc(100% / {{numTabs}});")
		})
	}

	onPageReset(() => {
		document.body?.classList.remove("btr-redesign")
	})

	onPageLoad(() => {
		// The class half of this is reversible, so it reapplies on change. The
		// template rewriting above still needs a reload, which is why the setting
		// is not listed as fully live.
		const applyLayoutClass = () => {
			document.body?.classList.toggle("btr-redesign", SETTINGS.get("groups.modifyLayout"))
		}

		document.$watch("body", applyLayoutClass)
		SETTINGS.onChange("groups.modifyLayout", applyLayoutClass)
	})
}
