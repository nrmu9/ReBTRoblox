import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { loadOptionalFeature } from "@/feat/loadFeature"
import { SETTINGS } from "@/feat/settings"
import { modifyAngularTemplate, onPageLoad, onPageReset } from "@/pages/common"

pageInit.groups = () => {
	if (SETTINGS.get("general.hoverPreview")) {
		loadOptionalFeature("previewer").then(() => {
			HoverPreview.register(".item-card", ".item-card-thumb-container")
		})
	}

	if (!SETTINGS.get("groups.enabled")) {
		return
	}

	if (SETTINGS.get("groups.modifyLayout")) {
		injectScript.call("groupsModifyLayout", () => {
			angularHook.hijackModule("group", {
				groupController(target: any, thisArg: any, args: any[], argsMap: any) {
					const result = target.apply(thisArg, args)

					try {
						const { $scope, groupDetailsConstants } = argsMap

						groupDetailsConstants.tabs.payouts = {
							state: "about",
							btrCustomTab: "payouts",
							translationKey: "Heading.Payouts",
						}

						$scope.btrCustomTab = {
							name: null,
						}

						hijackFunction(
							$scope,
							"groupDetailsTabs",
							(target: any, thisArg: any, args: any[]) => {
								let result = target.apply(thisArg, args)

								const entries: [string, any][] = Object.entries(result)

								if ($scope.isAuthenticatedUser && $scope.layout?.btrPayoutsEnabled) {
									entries.push(["payouts", groupDetailsConstants.tabs.payouts])
								}

								result = Object.fromEntries(entries)

								return result
							},
						)
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
				groupTab(target: any, thisArg: any, args: any[]) {
					const result = target.apply(thisArg, args)

					try {
						result.scope.btrCustomTab = "="
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			})

			angularHook.hijackModule("groupPayouts", {
				groupPayouts(component: HTMLElement) {
					;(component as any).bindings.layout = "="
				},
				groupPayoutsController(target: any, thisArg: any, args: any[], argsMap: any) {
					const result = target.apply(thisArg, args)

					try {
						const { groupPayoutsService } = argsMap
						const controller = thisArg

						hijackFunction(
							groupPayoutsService,
							"getGroupPayoutRecipients",
							(target: any, thisArg: any, args: any[]) => {
								const result = target.apply(thisArg, args)

								try {
									result.then(
										(recipients: any) =>
											(controller.layout.btrPayoutsEnabled = recipients.length > 0),
										() => (controller.layout.btrPayoutsEnabled = false),
									)
								} catch (ex) {
									console.error(ex)
								}

								return result
							},
						)
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			})
		})

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
		document.$watch("body", (body: HTMLElement) => {
			document.body.classList.toggle("btr-redesign", SETTINGS.get("groups.modifyLayout"))
		})
	})
}
