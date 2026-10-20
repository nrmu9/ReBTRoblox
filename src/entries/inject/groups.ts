import { hijackFunction } from "@/entries/inject/hooks"
import { angularHook } from "@/entries/inject/angular"

// Injected functions for group pages.

export const groupsFunctions: Record<string, (...args: any[]) => any> = {
	groupsModifyLayout: () => {
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

					hijackFunction($scope, "groupDetailsTabs", (target: any, thisArg: any, args: any[]) => {
						let result = target.apply(thisArg, args)

						const entries = Object.entries(result)

						if ($scope.isAuthenticatedUser && $scope.layout?.btrPayoutsEnabled) {
							entries.push(["payouts", groupDetailsConstants.tabs.payouts])
						}

						result = Object.fromEntries(entries)

						return result
					})
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
			groupPayouts(component: any) {
				component.bindings.layout = "="
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
	},
}
