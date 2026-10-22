import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { loadOptionalFeature } from "@/feat/loadFeature"
import { btrLocalStorage } from "@/core/storage"
import { waitForRobloxResponse } from "@/feat/robloxResponses"
import { SETTINGS } from "@/feat/settings"
import { keepTrackLabel } from "@/feat/activity/trackMenu"
import { openTracked } from "@/feat/activity/trackDialog"
import { addLeaveButtons } from "@/feat/quickRemove"
import {
	formatNumber,
	keepText,
	loggedInUserPromise,
	modifyAngularTemplate,
	onPageLoad,
	onPageReset,
} from "@/pages/common"

// A count Roblox shortened, "13.5M+ Members", split into the number and the
// words after it, which stay as Roblox wrote them, translated or not.
const ROUNDED_COUNT = /^([\d.,]+[KMB]?\+?)(\s.*)$/i

// Only a count in that form is rewritten, so anything else Roblox puts there
// is left alone.
const showExactCount = (element: HTMLElement, count: unknown) => {
	if (typeof count !== "number" || !Number.isSafeInteger(count)) {
		return
	}

	keepText(element, () => {
		const match = ROUNDED_COUNT.exec(element.textContent?.trim() ?? "")
		return match ? `${formatNumber(count)}${match[2]}` : null
	})
}

/**
 * The header's count from the community itself, the list's from your groups.
 * Both are answers Roblox asks for anyway, in before it draws the counts.
 */
const showExactMemberCounts = (groupId: number) => {
	const url = `https://groups.roblox.com/v1/groups/${groupId}`

	waitForRobloxResponse((responseUrl) => responseUrl === url)
		.then((json) => json ?? fetch(url, { credentials: "include" }).then((res) => res.json()))
		.then((group) => {
			document.$watchAll("button.radius-circle", (button: HTMLElement) => {
				showExactCount(button, group?.memberCount)
			})
		})
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
			const counts = new Map<string, number>()

			for (const entry of json?.data ?? []) {
				counts.set(String(entry.group?.id), entry.group?.memberCount)
			}

			document.$watchAll(".groups-list-item", (item: HTMLAnchorElement) => {
				const id = item.getAttribute("href")?.match(/\/communities\/(\d+)/)?.[1]
				const label = item.$find<HTMLElement>(
					".text-body-medium .text-body-medium, span.text-body-medium",
				)

				if (id && label) {
					showExactCount(label, counts.get(id))
				}
			})
		})
		.catch(() => {})
}

pageInit.groups = () => {
	if (SETTINGS.get("general.hoverPreview")) {
		loadOptionalFeature("previewer").then(({ HoverPreview }) => {
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

			// move most things out of about and into the main container
			const hoist = [
				aboutTemplate.$find("group-events"),
				aboutTemplate.$find("#group-announcements"),
				aboutTemplate.$find(".group-shout"),
				aboutTemplate.$find("social-links-container"),
			]

			for (const element of hoist) {
				if (!element) {
					continue
				}

				element.removeAttribute("ng-switch-when")
				tabs.before(element)
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

			// move discovery and group wall below the main container so it's visible in most views
			const discovery = aboutTemplate.$find("group-forums-discovery")
			if (discovery) {
				discovery.removeAttribute("ng-switch-when")
				discovery.setAttribute("ng-show", "layout.activeTab !== groupDetailsConstants.tabs.forums")
				tabs.parentElement!.append(discovery)
			}

			const wall = aboutTemplate.$find("group-wall")
			if (wall) {
				wall.removeAttribute("ng-switch-when")
				wall.setAttribute("ng-show", "layout.activeTab !== groupDetailsConstants.tabs.forums")
				tabs.parentElement!.append(wall)
			}
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
