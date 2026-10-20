import { settings, IS_DEV_MODE, RobuxToCash } from "@/entries/inject/state"
import { onSet, hijackFunction, hijackXHR } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions used across the site: robux to cash, popovers, experiments, and passing
// on the responses Roblox fetches anyway.

export const commonFunctions: Record<string, (...args: any[]) => any> = {
	redirectEvents: (fromSelector: string, toSelector: string) => {
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

		const redirected = new WeakSet<Event>()

		const callback = (event: Event) => {
			// dispatchEvent runs a capture phase, so a clone can re-enter this
			// capture listener if `to` is inside `from`. Never redirect twice.
			if (redirected.has(event)) {
				return
			}

			const clone = new (event.constructor as new (...args: any[]) => Event)(
				event.type,
				new Proxy(event, {
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
	initReactRobuxToCash: () => {
		reactHook.inject(".text-robux-lg", (elem: any) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux) && RobuxToCash.isEnabled()) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash-big",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".text-robux-tile", (elem: any) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux) && RobuxToCash.isEnabled()) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash-tile",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".text-robux", (elem: any) => {
			const originalText = elem[0].props.children
			if (typeof originalText !== "string") {
				return
			}

			const robux = parseInt(originalText.replace(/\D/g, ""), 10)

			if (Number.isSafeInteger(robux) && RobuxToCash.isEnabled()) {
				const cash = RobuxToCash.convert(robux)

				elem.append(
					reactHook.createElement("span", {
						className: "btr-robuxToCash",
						children: ` (${cash})`,
					}),
				)
			}
		})

		reactHook.inject(".icon-robux-container", (elem: any) => {
			const child = elem.find((x: any) => "amount" in x.props)

			if (child && RobuxToCash.isEnabled()) {
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
	},
	setupPopovers: () => {
		Roblox?.BootstrapWidgets?.SetupPopover(null, null, "[data-bind='popover-btr-download']")
	},
	// Passes on responses to requests Roblox makes anyway, so features read
	// them instead of asking again. The last few are kept, as the content
	// script can start listening after the first ones have come and gone.
	robloxResponses: () => {
		const PATTERNS = [
			/^https:\/\/presence\.roblox\.com\/v1\/presence\/users$/i,
			/^https:\/\/groups\.roblox\.com\/v1\/users\/\d+\/groups\/roles(?:\?|$)/i,
			/^https:\/\/games\.roblox\.com\/v1\/games\?universeIds=/i,
			/^https:\/\/groups\.roblox\.com\/v1\/groups\/\d+$/i,
			/^https:\/\/catalog\.roblox\.com\/v1\/favorites\/(?:assets|bundles)\/\d+\/count$/i,
		]

		const kept: Array<[string, any]> = []

		hijackXHR((request: any) => {
			if (!PATTERNS.some((pattern) => pattern.test(request.url))) {
				return
			}

			request.onResponse.push((json: any) => {
				kept.push([request.url, json])
				if (kept.length > 40) {
					kept.shift()
				}

				contentScript.send("robloxResponse", request.url, json)
			})
		})

		contentScript.listen("replayRobloxResponses", () => {
			for (const [url, json] of kept) {
				contentScript.send("robloxResponse", url, json)
			}
		})

		// Presence changes Roblox's realtime connection pushes as they
		// happen, each with the report Roblox would fetch and when the
		// session began. Ones without a report make Roblox fetch it,
		// which the hook above passes on.
		let tries = 0
		const subscribe = () => {
			const client = (window as any).Roblox?.RealTime?.Factory?.GetClient?.()

			if (!client) {
				if (++tries < 30) {
					setTimeout(subscribe, 1000)
				}
				return
			}

			client.Subscribe("PresenceBulkNotifications", (notifications: any) => {
				const presences: any[] = []
				const starts: Record<number, number> = {}

				for (const notification of Array.isArray(notifications) ? notifications : []) {
					const report = notification?.PresenceReport

					if (notification?.Type !== "PresenceChanged" || !report) {
						continue
					}

					presences.push({ ...report, userId: report.userId ?? notification.UserId })

					// Going offline starts now, not when the last session did.
					starts[notification.UserId] =
						report.userPresenceType > 0
							? Date.parse(notification.SessionStarted) || Date.now()
							: Date.now()
				}

				if (presences.length) {
					contentScript.send("robloxPresenceLive", presences, starts)
				}
			})
		}

		subscribe()
	},
	experiments: () => {
		const forcedExperiments = (experiment: string): Record<string, any> => {
			const game = settings.gamedetails

			if (
				experiment === "Website.GameDetails" &&
				game?.enabled !== false &&
				game?.previewVideos === "hidden"
			) {
				return { IsGamePreviewVideoEnabled: false }
			}

			return {}
		}

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
					for (const [key, value] of Object.entries(values) as [string, any][]) {
						modify(experiment, key, value)
					}
				}
			}
		} catch (ex) {
			console.error(ex)
		}

		const populate = (experiment: string, key: string | symbol, value: any) => {
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

									// Features built on Roblox's own flags. A value
									// set in the experiment editor still wins.
									for (const [key, value] of Object.entries(
										forcedExperiments(experiment),
									)) {
										if (!(key in (modified[experiment] ?? {}))) {
											layer[key] = value
										}
									}

									if (modified[experiment]) {
										for (const [key, modifiedValue] of Object.entries(
											modified[experiment],
										) as [string, any][]) {
											layer[key] = modifiedValue
										}
									}

									return new Proxy(layer, {
										get(target, key) {
											populate(experiment, key, undefined)
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
	},
	hijackAuth: () => {
		let didSendFirstAuth = false

		hijackXHR((request: any) => {
			if (
				!didSendFirstAuth &&
				request.method === "GET" &&
				request.url === `https://users.roblox.com/v1/users/authenticated`
			) {
				request.onResponse.push((json: any) => {
					if (!didSendFirstAuth) {
						didSendFirstAuth = true
						contentScript.send("onFirstAuth", json)
					}
				})
			}
		})
	},
	money: () => {
		reactHook.inject(".balance-label.icon-robux-container", (elem: any) => {
			const list = elem[0].props.children[0]?.props.children

			if (Array.isArray(list)) {
				const robux = parseInt(list.at(-1).replace(/\D/g, ""), 10)

				if (Number.isSafeInteger(robux) && RobuxToCash.isEnabled()) {
					const cash = RobuxToCash.convert(robux)

					list.push(
						reactHook.createElement("span", {
							className: "btr-robuxToCash",
							children: ` (${cash})`,
						}),
					)
				}
			}
		})
	},
	setupGamePopovers: (selector: string) => {
		Roblox?.BootstrapWidgets?.SetupPopover(null, null, selector)
	},
	linkify: (target: any) => $(target).linkify(),
}
