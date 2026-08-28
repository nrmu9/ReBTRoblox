// MAIN world script. Self-contained: it shares no module scope with the
// content scripts and talks to them only over btroblox/* CustomEvents.

// Registration cannot wait for the content bundle. That bundle is a dynamic
// import, and on a cold cache it lands after Roblox has already rendered, at
// which point a react hook registered too late never sees the components it was
// meant to transform. So everything here runs at document_start, and only the
// parts that actually read settings wait for btroblox/init.

let pageSettings: any = {}
let IS_DEV_MODE = false
let selectedRobuxToCashOption: any = null

/** Set once the body below has run, so init can hand over the real settings. */
let applySettings: ((settings: any, isDevMode: boolean, cashOption: any) => void) | null = null

const startInject = () => {
	{
		// Aliased so the body can keep reading `settings` while the outer binding
		// is what init replaces.
		const settings = new Proxy({} as any, {
			get: (_t, key) => pageSettings?.[key],
		})

		const ReBTRoblox: Record<string, any> = {}
		let currentPage: any = null
		void currentPage

		const util = {
			ready(fn: (...args: any[]) => any) {
				if (document.readyState === "loading") {
					document.addEventListener("DOMContentLoaded", fn, { once: true })
				} else {
					Promise.resolve().then(fn)
				}
			},

			assert(bool: boolean, ...args: any[]) {
				if (!bool) {
					throw new Error(...args)
				}
				return bool
			},
		}

		const onSet = (a: any, b: any, c: any) => {
			if (a[b]) {
				return c(a[b])
			}

			let descriptor: PropertyDescriptor
			try {
				descriptor = Object.getOwnPropertyDescriptor(a, b)!
			} catch (ex) {}

			Object.defineProperty(a, b, {
				enumerable: false,
				configurable: true,
				set(v) {
					delete a[b]
					try {
						Object.defineProperty(a, b, descriptor)
					} catch (ex) {}
					a[b] = v
					c(v)
				},
			})
		}

		const hijackFunction = (...args: any[]) => {
			if (args.length === 2) {
				return new Proxy(args[0], { apply: args[1] })
			}

			return (args[0][args[1]] = new Proxy(args[0][args[1]], { apply: args[2] }))
		}

		const xhrTransforms: any[] = []

		const hijackXHR = (fn: (...args: any[]) => any) => {
			xhrTransforms.push(fn)

			if (xhrTransforms.length === 1) {
				const xhrDetails = new WeakMap()

				hijackFunction(window, "fetch", (target: any, thisArg: any, args: any[]) => {
					let [url, params] = args

					if (typeof url === "string") {
						const request = {
							...(params || {}),
							method: params?.method || "GET",
							url: url,
							onRequest: [],
							onResponse: [],
						}

						for (const fn of xhrTransforms) {
							try {
								fn(request)
							} catch (ex) {
								console.error(ex)
							}
						}

						for (const fn of request.onRequest) {
							try {
								fn(request)
							} catch (ex) {
								console.error(ex)
							}
						}

						args[1] = { ...request }

						delete args[1].url
						delete args[1].onRequest
						delete args[1].onResponse

						const hijackResponse = (res: any) => {
							if (!request.onResponse.length) {
								return res
							}

							hijackFunction(res, "clone", (target: any, thisArg: any, args: any[]) => {
								return hijackResponse(target.apply(thisArg, args))
							})

							hijackFunction(res, "json", (target: any, thisArg: any, args: any[]) => {
								const promise = target.apply(thisArg, args)

								return promise.then((json: any) => {
									for (const fn of request.onResponse) {
										try {
											;(fn as any)(json, request)
										} catch (ex) {
											console.error(ex)
										}
									}

									return json
								})
							})

							hijackFunction(res, "text", (target: any, thisArg: any, args: any[]) => {
								const promise = target.apply(thisArg, args)

								return promise.then((text: string) => {
									try {
										const json = JSON.parse(text)

										for (const fn of request.onResponse) {
											try {
												;(fn as any)(json, request)
											} catch (ex) {
												console.error(ex)
											}
										}

										text = JSON.stringify(json)
									} catch (ex) {
										console.error(ex)
									}

									return text
								})
							})

							return res
						}

						return target.apply(thisArg, args).then(hijackResponse)
					}

					return target.apply(thisArg, args)
				})

				hijackFunction(XMLHttpRequest.prototype, "open", (target: any, xhr: any, args: any[]) => {
					const method = args[0]
					const url = args[1]

					xhrDetails.delete(xhr)

					if (typeof method === "string" && typeof url === "string") {
						const request = {
							method: method,
							url: url,
							onRequest: [],
							onResponse: [],
						}

						for (const fn of xhrTransforms) {
							try {
								fn(request)
							} catch (ex) {
								console.error(ex)
							}
						}

						if (request.onResponse.length) {
							const responseText = {
								configurable: true,

								get() {
									delete xhr.responseText
									let text = xhr.responseText

									try {
										const json = JSON.parse(text)

										for (const fn of request.onResponse) {
											try {
												;(fn as any)(json, request)
											} catch (ex) {
												console.error(ex)
											}
										}

										text = JSON.stringify(json)
									} catch (ex) {
										console.error(ex)
									}

									Object.defineProperty(xhr, "responseText", responseText)
									return text
								},
							}

							Object.defineProperty(xhr, "responseText", responseText)
						}

						args[0] = request.method
						args[1] = request.url

						if (request.onRequest.length) {
							xhrDetails.set(xhr, request)
						}
					}

					return target.apply(xhr, args)
				})

				hijackFunction(XMLHttpRequest.prototype, "send", (target: any, xhr: any, args: any[]) => {
					const request = xhrDetails.get(xhr)

					if (request) {
						xhrDetails.delete(xhr)

						request.body = args[0]

						for (const fn of request.onRequest) {
							try {
								fn(request)
							} catch (ex) {
								console.error(ex)
							}
						}

						args[0] = request.body
					}

					return target.apply(xhr, args)
				})
			}
		}

		//

		const formatNumber = (num: number | string) =>
			String(num).replace(/(\d\d*?)(?=(?:\d{3})+(?:\.|$))/gy, "$1,") // Intl.NumberFormat().format(num)

		const RobuxToCash = {
			selectedRobuxToCashOption: selectedRobuxToCashOption,

			getSelectedOption() {
				return this.selectedRobuxToCashOption
			},
			isEnabled() {
				const option = this.getSelectedOption()
				return !!option && option.name !== "none"
			},
			convert(robux: number) {
				const option = this.getSelectedOption()

				const cash = Math.round((robux * option.cash) / option.robux + 0.4999) / 100
				const cashString = formatNumber(cash.toFixed(option.currency.numFractions))

				return `${option.currency.symbol}${cashString}`
			},
		}

		const contentScript = {
			messageListeners: {} as Record<string, ((...args: any[]) => void)[]>,

			send(action: string, ...args: any[]) {
				document.dispatchEvent(new CustomEvent(`btroblox/content/${action}`, { detail: args }))
			},
			listen(action: string, callback: (...args: any[]) => any) {
				let listeners = this.messageListeners[action]

				if (!listeners) {
					listeners = this.messageListeners[action] = []

					document.addEventListener(`btroblox/inject/${action}`, (ev) => {
						const args = Array.isArray((ev as CustomEvent).detail)
							? (ev as CustomEvent).detail
							: []

						for (let i = listeners.length; i--;) {
							try {
								listeners[i].apply(null, args)
							} catch (ex) {
								console.error(ex)
							}
						}
					})
				}

				listeners.push(callback)
			},
		}

		const angularHook: Record<string, any> = {
			templateListeners: {},
			cachedTemplates: {},
			templateCaches: [],

			//

			moduleListeners: [],
			loadedModules: {},

			applyEntry(module: any, entry: any, callback: (...args: any[]) => any) {
				const [, type, data] = entry

				if (type === "constant" || type === "component") {
					try {
						callback(data[1])
					} catch (ex) {
						console.error(ex)
					}
					return
				}

				const hijack = (a: any, b: any, injects: any) => {
					const fn = a[b]

					if (typeof fn === "function") {
						hijackFunction(a, b, (target: any, thisArg: any, args: any[]) => {
							const argsMap: Record<string, any> = {}

							for (const [i, arg] of Object.entries(args) as [string, any][]) {
								argsMap[injects[i]] = arg
							}

							return callback(target, thisArg, args, argsMap)
						})
					}
				}

				if (typeof data[1] === "function") {
					hijack(data, 1, data[1].$inject)
				} else {
					hijack(data, data.length - 1, data)
				}
			},

			applyConfig(module: any, config: any, callback: (...args: any[]) => any) {
				const injects = config[2][0]

				if (typeof injects[injects.length - 1] !== "function") {
					return
				}

				hijackFunction(injects, injects.length - 1, (target: any, thisArg: any, args: any[]) => {
					const argsMap: Record<string, any> = {}

					for (let i = 0; i < injects.length - 1; i++) {
						argsMap[injects[i]] = args[i]
					}

					return callback(target, thisArg, args, argsMap)
				})
			},

			//

			hijackModule(moduleName: string, objects: any) {
				let module

				try {
					module = angular.module(moduleName)
				} catch (ex) {}

				if (module) {
					for (const entry of module._invokeQueue) {
						const callback = objects[entry[2][0]]
						if (callback) {
							this.applyEntry(module, entry, callback)
						}
					}
				}

				for (const [name, callback] of Object.entries(objects) as [string, any][]) {
					this.moduleListeners[moduleName] = this.moduleListeners[moduleName] ?? {}
					this.moduleListeners[moduleName][name] = this.moduleListeners[moduleName][name] ?? []
					this.moduleListeners[moduleName][name].push(callback)
				}
			},

			hijackConfig(moduleName: string, callback: (...args: any[]) => any) {
				let module

				try {
					module = angular.module(moduleName)
				} catch (ex) {}

				if (module) {
					for (const config of module._configBlocks) {
						this.applyConfig(module, config, callback)
					}
				}

				this.moduleListeners[moduleName] = this.moduleListeners[moduleName] ?? {}
				this.moduleListeners[moduleName].__configs = this.moduleListeners[moduleName].__configs ?? []
				this.moduleListeners[moduleName].__configs.push(callback)
			},

			//

			initModule(module: any) {
				if (this.loadedModules[module.name] === module) {
					return
				}
				this.loadedModules[module.name] = module

				if (module.name === "ng") {
					// Behold the monstrosity~

					hijackFunction(
						module._configBlocks[0][2][0],
						1,
						(target: any, thisArg: any, args: any[]) => {
							hijackFunction(args[0], "provider", (target: any, thisArg: any, args: any[]) => {
								if (args[0] instanceof Object && "$templateCache" in args[0]) {
									args[0].$templateCache = new Proxy(args[0].$templateCache, {
										construct: (target, args) => {
											const result = new target(...args)

											hijackFunction(
												result.$get,
												1,
												(target: any, thisArg: any, args: any[]) => {
													const cache = target.apply(thisArg, args)
													this.templateCaches.push(cache)

													hijackFunction(
														cache,
														"put",
														(target: any, thisArg: any, args: any[]) => {
															const key = args[0]

															if (this.templateListeners[key]) {
																delete this.templateListeners[key]
																contentScript.send(
																	"initTemplate",
																	key,
																	args[1],
																)
															}

															if (this.cachedTemplates[key]) {
																args[1] = this.cachedTemplates[key]
															}

															return target.apply(thisArg, args)
														},
													)

													return cache
												},
											)

											return result
										},
									})
								}

								return target.apply(thisArg, args)
							})

							return target.apply(thisArg, args)
						},
					)
				}

				const route = (queue: any, callback: (...args: any[]) => any) => {
					for (const entry of queue) {
						callback(entry)
					}

					const init = (target: any, thisArg: any, args: any[]) => {
						for (const entry of args) {
							callback(entry)
						}

						return target.apply(thisArg, args)
					}

					hijackFunction(queue, "unshift", init)
					hijackFunction(queue, "push", init)
				}

				route(module._configBlocks, (config) => {
					const listeners = this.moduleListeners[module.name]?.__configs
					if (!listeners) {
						return
					}

					for (const callback of listeners) {
						this.applyConfig(module, config, callback)
					}
				})

				route(module._invokeQueue, (entry: any) => {
					const name = entry[2][0]

					const listeners = this.moduleListeners[module.name]?.[name]
					if (!listeners) {
						return
					}

					for (const callback of listeners) {
						this.applyEntry(module, entry, callback)
					}
				})
			},

			init() {
				contentScript.listen("updateTemplate", (key: string, html: string) => {
					this.cachedTemplates[key] = html

					for (const cache of this.templateCaches) {
						if (cache.get(key)) {
							cache.put(key, html)
						}
					}
				})

				contentScript.listen("listenForTemplate", (key: string) => {
					for (const cache of this.templateCaches) {
						const html = cache.get(key)

						if (html) {
							contentScript.send("initTemplate", key, html)
							return
						}
					}

					this.templateListeners[key] = true
				})

				onSet(window, "angular", (angular: any) => {
					onSet(angular, "module", () => {
						let didInitNg = false

						hijackFunction(angular, "module", (target: any, thisArg: any, args: any[]) => {
							if (!didInitNg) {
								didInitNg = true
								this.initModule(target.call(angular, "ng"))
							}

							const module = target.apply(thisArg, args)
							this.initModule(module)
							return module
						})
					})
				})
			},
		}

		const reactHook: Record<string, any> = {
			cachedSelectors: {},
			constructorProxies: new WeakMap(),
			constructorReplaces: [],
			injectedContent: [],
			globalHijackState: [],
			renderTarget: null as any,

			//

			parseReactStringSelector(selector: string) {
				if (this.cachedSelectors[selector]) {
					return this.cachedSelectors[selector]
				}

				util.assert(!/[[+~]/.exec(selector), "complex selectors not supported")
				const result: any[] = []

				for (const option of selector.split(/,/)) {
					let nextIsDirect = false
					let previous

					for (let piece of option.split(/\s+|(?=>)/)) {
						piece = piece.trim()
						if (!piece.length) {
							continue
						}

						if (piece[0] === ">") {
							util.assert(!nextIsDirect, "duplicate direct child selector")
							nextIsDirect = true

							if (piece.length === 1) {
								continue
							}

							piece = piece.slice(1)
						}

						const attributes = piece.split(/(?=[#.])/)
						const obj: Record<string, any> = {}

						if (nextIsDirect) {
							obj.direct = true
						}

						for (const attr of attributes) {
							if (attr[0] === ".") {
								obj.classList = obj.classList ?? []
								obj.classList.push(attr.slice(1))
							} else if (attr[0] === "#") {
								obj.props = obj.props ?? {}
								obj.props.id = attr.slice(1)
							} else {
								if (attr !== "*") {
									// unset obj.type acts as universal selector
									obj.type = attr.toLowerCase()
								}
							}
						}

						if (previous) {
							previous.next = obj
						} else {
							result.push(obj) // Add first selector to result
						}

						previous = obj
						nextIsDirect = false
					}
				}

				this.cachedSelectors[selector] = result

				return result
			},

			parseReactSelector(selectors: any) {
				selectors = Array.isArray(selectors) ? selectors : [selectors]
				const result: any[] = []

				for (let i = 0, len = selectors.length; i < len; i++) {
					const selector = selectors[i]

					if (typeof selector === "string") {
						result.push(...reactHook.parseReactStringSelector(selector))
						continue
					}

					// if(selector.selector) {
					// 	util.assert(!selector.next)
					// 	const selectors = reactHook.parseReactStringSelector(selector)

					// 	const fillMissingData = targets => {
					// 		for(const target of targets) {
					// 			if(target.next) {
					// 				fillMissingData(target.next)
					// 				continue
					// 			}

					// 			for(const key of selector) {
					// 				if(key === "selector") { continue }
					// 				const value = selector[key]

					// 				if(Array.isArray(value)) {
					// 					target[key] = target[key] ?? []
					// 					target[key].push(...value)

					// 				} else if(typeof value === "object" && value !== null) {
					// 					target[key] = target[key] ?? {}
					// 					Object.assign(target[key], value)

					// 				} else {
					// 					target[key] = value
					// 				}
					// 			}
					// 		}
					// 	}

					// 	fillMissingData(selectors)
					// 	result.push(...selectors)
					// 	continue
					// }

					result.push(selector)
				}

				return result
			},

			selectorMatches(elem: any, selectors: any) {
				if (!elem?.props) {
					return false
				}

				main: for (const selector of this.parseReactSelector(selectors)) {
					if (
						selector.type &&
						(typeof elem.type !== "string" ||
							selector.type.toLowerCase() !== elem.type.toLowerCase())
					) {
						continue main
					}

					if (selector.key && selector.key !== elem.key) {
						continue main
					}

					if (selector.hasProps) {
						for (const key of selector.hasProps) {
							if (!(key in elem.props)) {
								continue main
							}
						}
					}

					if (selector.props) {
						for (const key of Object.keys(selector.props)) {
							if (selector.props[key] !== elem.props[key]) {
								continue main
							}
						}
					}

					if (selector.classList) {
						const classes =
							typeof elem.props.className === "string" ? elem.props.className.split(/\s+/g) : []

						for (const className of selector.classList) {
							if (!classes.includes(className)) {
								continue main
							}
						}
					}

					return true
				}

				return false
			},

			queryElement(
				targets: any,
				queries: any,
				depth: any = 5,
				mustMatchRoot: any = false,
				all: any = false,
				path: any = false,
			) {
				if (all && path) {
					throw Error("Can't do both all and path")
				}

				if (!Array.isArray(targets)) {
					targets = [targets]
				}
				if (!Array.isArray(queries)) {
					queries = [queries]
				}

				const temp: any[] = all ? [] : []

				for (const target of targets) {
					if (!target?.props) {
						continue
					}

					for (const query of queries) {
						if (typeof query === "function") {
							if (query(target)) {
								if (all) {
									temp.push(target)
								} else if (path) {
									return [target]
								} else {
									return target
								}
							}
						} else {
							if (this.selectorMatches(target, query)) {
								if (!query.next) {
									if (all) {
										if (!temp.includes(target)) {
											temp.push(target)
										}
										continue
									} else if (path) {
										return [target]
									} else {
										return target
									}
								}

								const result = this.queryElement(
									target.props.children,
									query.next,
									depth - 1,
									query.direct,
									all,
									path,
								)

								if (result) {
									if (all) {
										temp.push(...result)
									} else if (path) {
										result.unshift(target)
										return result
									} else {
										return result
									}
								}
							}
						}
					}

					if (depth >= 2 && !mustMatchRoot) {
						const result = this.queryElement(
							target.props.children,
							queries,
							depth - 1,
							mustMatchRoot,
							all,
							path,
						)

						if (result) {
							if (all) {
								temp.push(...result)
							} else if (path) {
								result.unshift(target)
								return result
							} else {
								return result
							}
						}
					}
				}

				if (all && temp.length > 0) {
					return temp
				}

				return null
			},

			_queryList(list: any, selectors: any, depth?: any, all: any = false, path: any = false) {
				for (const child of list) {
					if (Array.isArray(child)) {
						const result = this._queryList(child, selectors, depth, all, path)

						if (result) {
							return result
						}
					} else if (child?.props) {
						const newSelectors: any[] = []
						let matches = false

						for (const selector of selectors) {
							if (typeof selector === "function") {
								if (selector(child)) {
									matches = true
									if (!all) {
										break
									}
								}
							} else {
								if (reactHook.selectorMatches(child, selector)) {
									if (selector.next) {
										newSelectors.push(selector.next)
									} else {
										matches = true
										if (!all) {
											break
										}
									}
								}

								if (!selector.direct) {
									newSelectors.push(selector)
								}
							}
						}

						if (matches) {
							if (all) {
								if (path) {
									all.push([...path, child])
								} else {
									all.push(child)
								}
							} else {
								if (path) {
									path.push(child)
									return path
								} else {
									return child
								}
							}
						}

						if (newSelectors.length > 0 && depth > 0) {
							if (path) {
								path.push(child)
							}
							const result = this._queryList(
								[child.props.children],
								newSelectors,
								depth - 1,
								all,
								path,
							)
							if (path) {
								path.pop()
							}

							if (result) {
								return result
							}
						}
					}
				}
			},

			querySelector(element: any, selectors: any, depth = 5, path = false) {
				if (!element?.props) {
					return null
				}
				selectors = this.parseReactSelector(selectors)

				return this._queryList(
					[element.props.children],
					selectors,
					depth,
					false,
					path ? [element] : null,
				)
			},

			querySelectorAll(element: any, selectors: any, depth = 5, path = false) {
				if (!element?.props) {
					return null
				}
				selectors = this.parseReactSelector(selectors)

				const all: any[] = []
				this._queryList([element.props.children], selectors, depth, all, path ? [element] : null)

				return all
			},

			//

			wrappedProto: Object.defineProperties(
				<Record<string, any>>{
					btrIsWrapped: true,

					matches(selector: string) {
						return reactHook.selectorMatches(this[0], selector)
					},

					parent() {
						return this.path.length <= 2 ? null : reactHook.wrap(this.path.slice(0, -1))
					},

					_children(flatten = false) {
						let children = this[0].props.children

						if (!children) {
							children = this[0].props.children = []
						} else if (!Array.isArray(children)) {
							children = this[0].props.children = [children]
						}

						if (flatten && !this._flattened) {
							this._flattened = true
							children = this[0].props.children = children.flat(16)
						}

						return children
					},

					prepend(elem: any) {
						this._children().unshift(reactHook.unwrap(elem))
					},

					append(elem: any) {
						this._children().push(reactHook.unwrap(elem))
					},

					before(...elems: any[]) {
						const parent = this.parent()

						const children = parent ? parent._children(true) : this.path[0]
						const index = children.indexOf(this[0])

						if (index !== -1) {
							children.splice(index, 0, ...elems.map(reactHook.unwrap))
						}
					},

					after(...elems: any[]) {
						const parent = this.parent()

						const children = parent ? parent._children(true) : this.path[0]
						const index = children.indexOf(this[0])

						if (index !== -1) {
							children.splice(index + 1, 0, ...elems.map(reactHook.unwrap))
						}
					},

					replaceWith(...elems: any[]) {
						const parent = this.parent()

						const children = parent ? parent._children(true) : this.path[0]
						const index = children.indexOf(this[0])

						if (index !== -1) {
							children.splice(index, 1, ...elems.map(reactHook.unwrap))
						}

						this.path = [[], this[0]]
					},

					remove() {
						this.replaceWith()
					},

					find(selector: string, depth = 5) {
						const path = reactHook.querySelector(this[0], selector, depth, true)
						if (!path) {
							return null
						}

						return reactHook.wrap([...this.path, ...path.slice(1)])
					},
				},
				{
					classList: {
						configurable: true,
						get() {
							Object.defineProperty(this, "classList", {
								value: {
									contains: (input: any) => {
										return (this[0].props.className ?? "").split(" ").includes(input)
									},
									add: (...input: string[]) => {
										const classNames = (this[0].props.className ?? "").split(" ")

										for (const className of input) {
											if (!classNames.includes(className)) {
												classNames.push(className)
											}
										}

										this[0].props.className = classNames.join(" ")
									},
									remove: (...input: string[]) => {
										const classNames = (this[0].props.className ?? "").split(" ")

										for (const className of input) {
											const index = classNames.indexOf(className)
											if (index !== -1) {
												classNames.splice(index, 1)
											}
										}

										this[0].props.className = classNames.join(" ")
									},
									toggle: (input: any, force: boolean) => {
										if (
											force === true ||
											(force !== false && !this.classList.contains(input))
										) {
											this.classList.add(input)
										} else {
											this.classList.remove(input)
										}
									},
								},
							})

							return this.classList
						},
					},
				},
			),

			unwrap(elem: any) {
				return elem?.btrIsWrapped ? elem[0] : elem
			},

			wrap(path: any) {
				if (!Array.isArray(path)) {
					throw new Error("path is not an array")
				}
				const wrapped = { [0]: path.at(-1), path: path, __proto__: this.wrappedProto }
				return wrapped
			},

			//

			createGlobalState(value: any) {
				return {
					listeners: new Set(),
					value: value,
					counter: 0,

					set(value: any) {
						this.value = value
						this.update()
					},

					update() {
						this.counter++

						for (const setValue of this.listeners.values()) {
							;(setValue as any)(this.counter)
						}
					},
				}
			},

			useGlobalState(globalState: any) {
				const [, setValue] = this.React.useState()

				this.React.useEffect(() => {
					globalState.listeners.add(setValue)
					return () => {
						globalState.listeners.delete(setValue)
					}
				}, [])

				return globalState.value
			},

			//

			hijackConstructor(filter: (...args: any[]) => any, handler: (...args: any[]) => any) {
				const info = {
					index: this.constructorReplaces.length,
					filter,
					handler,

					remove() {
						;(this as any).removed = true
					},
				}

				this.constructorReplaces.push(info)
				return info
			},

			hijackUseState(
				filter: (...args: any[]) => any,
				transform: (...args: any[]) => any,
				permanent: boolean,
			) {
				const renderTarget = this.renderTarget

				if (!renderTarget) {
					throw new TypeError("not in a render method")
				}

				if (!renderTarget.hijackState) {
					renderTarget.hijackState = []
				}
				renderTarget.hijackState.push({ filter, transform, permanent })
			},

			hijackUseStateGlobal(filter: (...args: any[]) => any, transform: (...args: any[]) => any) {
				this.globalHijackState.push({ filter, transform })
			},

			inject(selector: string, callback: (...args: any[]) => any) {
				this.injectedContent.push({
					selector: this.parseReactSelector(selector),
					callback: callback,
				})
			},

			//

			nextConstructorReplace(render: any, index: any, thisArg?: any, args?: any) {
				for (; index < reactHook.constructorReplaces.length; index++) {
					const info = reactHook.constructorReplaces[index]

					if (info.removed) {
						reactHook.constructorReplaces.splice(index--, 1)
						continue
					}

					// React can invoke a component with no props. Every filter uses the `in`
					// operator, which throws on a non object, and a throw here unmounts whatever
					// React was rendering.
					const props = args[0]
					if (props === null || typeof props !== "object") {
						continue
					}

					let matches = false

					try {
						matches = info.filter(props)
					} catch (err) {
						console.error("[btr] constructor filter failed", err)
						continue
					}

					if (matches) {
						return info.handler(
							function (this: any, ...args: any[]) {
								return reactHook.nextConstructorReplace(render, index + 1, this as any, args)
							},
							thisArg,
							args,
						)
					}
				}

				return render.apply(thisArg, args)
			},

			renderProxyProps: {
				apply(render: any, thisArg: any, args: any[]) {
					if (reactHook.renderTarget) {
						return reactHook.nextConstructorReplace(render, 0, thisArg, args)
					}

					return render.apply(thisArg, args)
				},
			},

			applyProxy(result: any) {
				const type = result.type
				if (!type) {
					return
				}

				let target: any, key!: string, render: any

				if (typeof type === "function") {
					if (type.prototype?.isReactComponent) {
						target = type.prototype
						key = "render"
						render = type.prototype.render
					} else {
						target = result
						key = "type"
						render = type
					}
				} else if (typeof type === "object") {
					if (typeof type.render === "function") {
						target = type
						key = "render"
						render = type.render
					} else if (typeof type.type === "function") {
						target = type
						key = "type"
						render = type.type
					}
				}

				if (typeof render === "function" && !this.constructorProxies.get(render)) {
					const proxy = new Proxy(render, this.renderProxyProps)
					this.constructorProxies.set(proxy, true)
					target[key] = proxy
				}
			},

			onCreateElement(target: any, thisArg: any, args: any[]) {
				const result = target.apply(thisArg, args)

				const root = [result]
				let wrapped

				outer: for (const content of this.injectedContent) {
					try {
						const matching: any[] = []

						for (const selector of content.selector) {
							if (reactHook.selectorMatches(result, selector)) {
								if (selector.next) {
									matching.push(selector)
								} else {
									if (!wrapped) {
										wrapped = reactHook.wrap([root, result])
									}

									content.callback(wrapped)

									if (!root.includes(result)) {
										break outer
									}
								}
							}
						}

						if (matching.length > 0) {
							for (const path of reactHook.querySelectorAll(result, matching, 5, true)) {
								const child = reactHook.wrap([root, ...path])

								content.callback(child)

								if (!root.includes(result)) {
									break outer
								}
							}
						}
					} catch (ex) {
						console.error(ex)
					}
				}

				return root.length >= 2 ? root : root[0]
			},

			onUseState(target: any, thisArg: any, args: any[]) {
				const renderTarget = this.renderTarget

				if (!renderTarget) {
					return target.apply(thisArg, args)
				}

				const stateIndex = renderTarget.state.length
				const matching: any[] = []

				const run = (list: any, canResolve?: any) => {
					for (const filter of list) {
						if (!filter.resolved && filter.filter(args[0], stateIndex)) {
							if (canResolve) {
								filter.resolved = true
							}

							if (filter.transform) {
								args[0] = filter.transform(args[0], true)
							}

							matching.push(filter)
						}
					}
				}

				if (renderTarget.hijackState) {
					run(renderTarget.hijackState, !renderTarget.permanent)
				}

				run(this.globalHijackState)

				const result = target.apply(thisArg, args)

				for (const filter of matching) {
					if (filter.transform) {
						result[1] = new Proxy(result[1], {
							apply(target: any, thisArg: any, args: any[]) {
								args[0] = filter.transform(args[0], false)
								return target.apply(thisArg, args)
							},
						})
					}
				}

				renderTarget.state.push(result)

				return result
			},

			onReact(_react: any) {
				this.React = _react

				hijackFunction(this.React, "createElement", this.onCreateElement.bind(this))
				hijackFunction(this.React, "useState", this.onUseState.bind(this))

				const dispatcher =
					this.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
				let current = dispatcher.current

				// let lastFiber

				Object.defineProperty(Object.prototype, "lanes", {
					configurable: true,
					get() {
						return undefined
					},
					set(value) {
						Object.defineProperty(this, "lanes", {
							enumerable: true,
							configurable: true,
							writable: true,
							value: value,
						})

						if ("tag" in this && "pendingProps" in this) {
							const fiber = this

							if (!fiber.btrAttached) {
								fiber.btrAttached = true

								let type = fiber.type
								try {
									reactHook.applyProxy(fiber)
								} catch (ex) {
									console.error(ex)
								}

								Object.defineProperty(fiber, "type", {
									configurable: true,
									get() {
										return type
									},
									set(newType) {
										type = newType
										try {
											reactHook.applyProxy(fiber)
										} catch (ex) {
											console.error(ex)
										}
									},
								})
							}
						}

						// console.log("fiber?", this)

						// Object.defineProperty(this, "updateQueue", {
						// 	enumerable: true,
						// 	configurable: true,
						// 	get() { return value },
						// 	set(_value) {
						// 		value = _value

						// 		if(value === null) {
						// 			lastFiber = this
						// 		}
						// 	}
						// })
					},
				})

				Object.defineProperty(dispatcher, "current", {
					enumerable: true,
					get() {
						return current
					},
					set(value) {
						current = value

						// According to ReactFiberHooks.js, current will be set to ContextOnlyDispatcher when not rendering
						if (current && current.useCallback !== current.useEffect) {
							reactHook.renderTarget = {
								// fiber: lastFiber,
								state: [],
							}
						} else {
							reactHook.renderTarget = null
						}
					},
				})
			},

			createElement(...args: any[]) {
				return this.React.createElement(...args)
			},

			//

			init() {
				onSet(window, "React", this.onReact.bind(this))
				onSet(window, "ReactJSX", (jsx: any) => {
					hijackFunction(jsx, "jsxs", this.onCreateElement.bind(this))
					hijackFunction(jsx, "jsx", this.onCreateElement.bind(this))
				})
			},
		}

		//

		const injectedFunctions: Record<string, (...args: any[]) => any> = {
			// Insert injected functions here,
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
			assetRefinement: () => {
				onSet(window, "Roblox", (Roblox: any) => {
					onSet(Roblox, "AvatarAccoutrementService", (AvatarAccoutrementService: any) => {
						let wearingAssets: any
						let avatarRules: any

						hijackFunction(
							AvatarAccoutrementService,
							"removeAssetFromAvatar",
							(target: any, thisArg: any, args: any[]) => {
								if (args[0] === "btrGetWearingAssets") {
									wearingAssets = args[1]
									throw "ReBTRoblox: abort (this should never be visible)"
								}

								return target.apply(thisArg, args)
							},
						)

						angularHook.hijackModule("avatar", {
							avatarController(target: any, thisArg: any, args: any[], argsMap: any) {
								const result = target.apply(thisArg, args)

								try {
									const { $scope, avatarConstantService } = argsMap

									const updateWearingAssets = () => {
										if (!wearingAssets || !avatarRules) {
											return
										}

										for (const item of wearingAssets) {
											if (
												avatarRules.accessoryRefinementTypes.includes(
													item.assetType.id,
												)
											) {
												if (!item.meta) {
													item.meta = { version: 1 }
												}
												if (!item.meta.position) {
													item.meta.position = { X: 0, Y: 0, Z: 0 }
												}
												if (!item.meta.rotation) {
													item.meta.rotation = { X: 0, Y: 0, Z: 0 }
												}
												if (!item.meta.scale) {
													item.meta.scale = { X: 1, Y: 1, Z: 1 }
												}
											}
										}
									}

									$scope.btrUpdateItem = (item: any) => {
										if (item.meta?.scale && item.btrScale) {
											item.meta.scale.X = item.btrScale
											item.meta.scale.Y = item.btrScale
											item.meta.scale.Z = item.btrScale
										}

										$scope.onHatSlotClicked({ id: -1, assetType: { id: 8, name: "Hat" } })
									}

									$scope.btrRefreshWearingAssets = () => {
										try {
											$scope.onHatSlotClicked("btrGetWearingAssets")
										} catch (ex) {}

										$scope.btrWearingAssets = wearingAssets || []
										updateWearingAssets()
									}

									$scope.btrRefreshWearingAssets()

									$scope.$on(
										avatarConstantService.events.wornAssetsChanged,
										(_event: Event, _assetIds: any) => {
											$scope.btrRefreshWearingAssets()
										},
									)

									$scope.$on(
										avatarConstantService.events.avatarRulesLoaded,
										(event: Event, rules: any) => {
											$scope.btrAvatarRules = avatarRules = rules
											$scope.btrBounds = {}

											for (const [assetTypeName, lowerBounds] of Object.entries(
												avatarRules.accessoryRefinementLowerBounds,
											) as [string, any][]) {
												const upperBounds =
													avatarRules.accessoryRefinementUpperBounds[assetTypeName]

												const wearableAssetType = avatarRules.wearableAssetTypes.find(
													(x: any) => x.name.replace(/\s/, "") === assetTypeName,
												)
												const assetBounds: Record<string, any> = ($scope.btrBounds[
													wearableAssetType?.id
												] = {})

												for (const [category, values] of Object.entries(
													lowerBounds,
												) as [string, any][]) {
													const bounds: Record<string, any> = (assetBounds[
														category
													] = {})

													for (const [key, value] of Object.entries(values) as [
														string,
														any,
													][]) {
														bounds[key.slice(0, 1).toUpperCase()] = {
															min: value,
															max: upperBounds[category][key],
														}
													}
												}
											}

											updateWearingAssets()
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
			showOwnedAssets: () => {
				const ownedAssets: Record<string, any> = {}

				contentScript.listen("updateOwnedAssets", (changes) => {
					for (const [assetId, isOwned] of Object.entries(changes) as [string, any][]) {
						ownedAssets[+assetId]?.set(isOwned)
					}
				})

				reactHook.hijackConstructor(
					// ItemCard
					(props: any) => "unitsAvailableForConsumption" in props && "id" in props,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]
						const result = target.apply(thisArg, args)

						if (props.type === "Asset" && props.id) {
							let state = ownedAssets[props.id]

							if (!state) {
								state = reactHook.createGlobalState(false)
								ownedAssets[props.id] = state

								contentScript.send("checkOwnedAsset", props.id)
							}

							const owned = reactHook.useGlobalState(state)

							if (owned) {
								result.props.className = (result.props.className ?? "") + " btr-owned"

								const parent = reactHook.queryElement(result, (x: any) =>
									x.props.className?.includes("item-card-link"),
								)

								if (parent) {
									let children = parent.props.children

									if (!Array.isArray(children)) {
										children = parent.props.children = children ? [children] : []
									}

									children.unshift(
										reactHook.createElement("span", {
											className: "btr-item-owned",
											children: reactHook.createElement("span", {
												className: "icon-checkmark-white-bold",
												title: "You own this item",
											}),
										}),
									)
								}
							}
						}

						return result
					},
				)
			},
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

				const callback = (event: Event) => {
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

					if (!to.dispatchEvent(clone)) {
						event.preventDefault()
					}
				}

				for (const event of events) {
					from.addEventListener(event, callback, { capture: true })
				}
			},
			initReactFriends: () => {
				reactHook.hijackConstructor(
					// FriendsCarouselContainer
					(props: any) => "profileUserId" in props && "carouselName" in props,
					(target: any, thisArg: any, args: any[]) => {
						// disable MustHideConnections so that friends load in faster
						reactHook.hijackUseState(
							(value: any, index: number) => value === false && index === 4,
							(value: any, initial: any) => (initial ? true : value),
						)

						const result = target.apply(thisArg, args)

						// if MustHideConnect is enabled, communicate that to profile code somehow
						if (reactHook.renderTarget?.state?.[4]?.[0] === false) {
							const noFriendsLabel = reactHook.querySelector(
								result,
								".friends-carousel-0-friends",
							)

							if (noFriendsLabel) {
								noFriendsLabel.props.className += " btr-friends-carousel-disabled"
							}
						}

						return result
					},
				)

				reactHook.hijackConstructor(
					// FriendsList
					(props: any) => "friendsList" in props,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]
						const friendsList = props.friendsList
						const carouselName = props.carouselName

						let showSecondRow = false

						if (carouselName === "WebHomeFriendsCarousel") {
							showSecondRow = settings.home?.friendsSecondRow
						} else if (carouselName === "WebProfileFriendsCarousel") {
							showSecondRow = settings.home?.friendsSecondRow

							// Fixes an issue where profile friends list shows one too few friends
							props.isAddFriendsTileEnabled = false
						}

						if (showSecondRow) {
							reactHook.hijackUseState(
								// visibleFriendsList
								(value: any, _index: number) => value === friendsList,
								(value: any, initial: any) => {
									if (value && friendsList && !initial) {
										let count = value.length * 2

										if (carouselName === "WebHomeFriendsCarousel") {
											const isTwoLines = value.length < friendsList.length
											localStorage.setItem(
												"ReBTRoblox:homeFriendsIsTwoLines",
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
									localStorage.getItem("ReBTRoblox:homeFriendsIsTwoLines") === "true"
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

				if (settings.home?.friendsShowUsername) {
					const friendsState = reactHook.createGlobalState({})

					hijackXHR((request: any) => {
						if (
							request.method === "POST" &&
							request.url ===
								"https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles"
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
						(props: any) => props.displayName && props.userProfileUrl,
						(target: any, thisArg: any, args: any[]) => {
							const result = target.apply(thisArg, args)

							try {
								const userId = args[0].id

								const labels = reactHook.queryElement(result, (x: any) =>
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

				if (settings.home?.friendPresenceLinks) {
					reactHook.hijackConstructor(
						// FriendTileDropdown
						(props: any) => props.friend && props.gameUrl,
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
			addBTRSettings: () => {
				reactHook.inject("#settings-popover-menu", (elem: any) => {
					elem.prepend(
						reactHook.createElement("li", {
							dangerouslySetInnerHTML: {
								__html: `<a class="rbx-menu-item btr-settings-toggle">BTR Settings</a>`,
							},
						}),
					)
				})
			},
			cacheRobuxAmount: () => {
				reactHook.hijackConstructor(
					(props: any) =>
						"isGetCurrencyCallDone" in props &&
						"isExperimentCallDone" in props &&
						"robuxAmount" in props,
					(target: any, thisArg: any, args: any[]) => {
						try {
							const props = args[0]

							if (props.isGetCurrencyCallDone && props.isExperimentCallDone) {
								if (Number.isSafeInteger(props.robuxAmount)) {
									localStorage.setItem("ReBTRoblox:cachedRobux", props.robuxAmount)
								}
							} else {
								const cachedRobux = localStorage.getItem("ReBTRoblox:cachedRobux")

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
			},
			higherRobuxPrecision: () => {
				onSet(window, "CoreUtilities", (CoreUtilities: any) => {
					hijackFunction(
						CoreUtilities.abbreviateNumber,
						"getTruncValue",
						(target: any, thisArg: any, args: any[]) => {
							// The navbar robux badge is the only caller that passes a lone
							// value; the friend and message counters pass their own
							// threshold. That alone identifies it, so this no longer waits
							// on a react constructor hijack to set a flag, which is what
							// stopped the feature working when the props moved.
							//
							// Read the setting per call: the hook installs before init has
							// delivered settings, so it cannot be gated at registration.
							// Optional: the hook installs at document_start, before init has
							// delivered settings, and reading through the proxy would throw
							// until then. Defaults on, which matches the setting.
							if (args.length === 1 && settings.general?.higherRobuxPrecision !== false) {
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
			},
			hideFriendActivity: () => {
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
									delete gameData.friendActivityTitle
								}
							}
						})
					}
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
					(accessoryAssetTypeIds.includes(+assetTypeId) ||
						layeredAssetTypeIds.includes(+assetTypeId))

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

					if (
						(key === LIMIT_KEY || key === LAYERED_KEY || key === TYPE_KEY || key === ADD_KEY) &&
						typeof args[2]?.get === "function"
					) {
						const descriptor = args[2]
						const readOriginal = descriptor.get
						let replacement: any
						let resolved = false

						args[2] = {
							...descriptor,
							get() {
								if (!resolved) {
									resolved = true
									replacement = replaceValue(key, readOriginal.call(this))
								}

								return replacement
							},
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

									for (const assetTypeId of [
										...accessoryAssetTypeIds,
										...layeredAssetTypeIds,
									]) {
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
					(props: any) =>
						"closeDialog" in props && "isOpen" in props && Object.keys(props).length === 2,
					(target: any, thisArg: any, args: any[]) => {
						const result = target.apply(thisArg, args)

						if (confirming || !args[0]?.isOpen || !settings.avatar?.ignoreR6Warning) {
							return result
						}

						const action = reactHook.queryElement(
							result,
							(elem: any) =>
								elem.props?.variant === "Emphasis" &&
								typeof elem.props?.onClick === "function",
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
			experiments: () => {
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
											for (const [key, value] of Object.entries(layer) as [
												string,
												any,
											][]) {
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
											if (
												typeof module === "object" &&
												!this.processedModules.has(module)
											) {
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
			createAddBTRSettings: () => {
				const { webpackHook } = ReBTRoblox
				const objects: Record<string, any> = webpackHook.objects

				reactHook.hijackConstructor(
					(props: any) => props.settingsHref,
					(target: any, thisArg: any, args: any[]) => {
						const result = target.apply(thisArg, args)

						try {
							const list = reactHook.queryElement(
								result,
								(x: any) => x.props.id === "top-navigation-authentication-status-menu",
							)

							if (list) {
								list.props.children.unshift(
									objects.jsx(objects.Mui.MenuItem, {
										children: "BTR Settings",
										className: "btr-settings-toggle",
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

									index = children.findIndex(
										(x) => x?.props.itemKey === "Action.CopyStartPlaceID",
									)
									if (index !== -1) {
										children[index].props.style = { display: "none" }
									} // HACK: Keep in dom for styling purposes

									index = children.findIndex(
										(x) => x?.key === "Action.OpenExperienceDetails",
									)
									if (index !== -1) {
										const entry = children[index]
										delete entry.props.onClick

										children[index] = Link(
											`https://www.roblox.com/games/${args[0].creation.assetId}/`,
											entry,
										)
									}

									index = children.findIndex(
										(x) => x?.key === "Action.ConfigureLocalization",
									)
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

									index = children.findIndex(
										(x) => x?.key === "Action.OpenExperienceDetails",
									)
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

									index = children.findIndex(
										(x) => x?.props?.itemKey === "Action.Analytics",
									)
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

									// let index = children.indexOf(assetDetail)
									// if(index !== -1) { children.splice(index, 1) }

									let index = children.findIndex((x) => x?.key === "copy-asset-id")
									if (index !== -1) {
										children.splice(index, 1)
									}

									children.splice(
										children.indexOf(assetDetail) + 1,
										0,
										// objects.jsx(objects.Mui.Divider, {}),
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
			pagedServers: () => {
				const largePageSize = 100
				const pageSize = 12

				const btrPager = <Record<string, any>>{
					currentPage: 1,
					targetPage: 1,
					maxPage: 1,
					loading: false,
				}
				const promises: Record<string, any> = {}
				const cursors: any[] = []

				const btrPagerState = reactHook.createGlobalState(btrPager)
				const serverParams = { sortOrder: "Desc", excludeFullGames: false }

				const loadLargePage = async (placeId: number, largePageIndex: number) => {
					if (largePageIndex >= cursors.length + 2) {
						throw new Error("Tried to load page with no cursor")
					}

					const cursor = cursors[largePageIndex - 2] ?? ""

					const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=${serverParams.sortOrder}&excludeFullGames=${serverParams.excludeFullGames}&limit=${largePageSize}&cursor=${cursor}`
					let promise = promises[url]

					if (!promise) {
						let numRetries = 0

						const tryRetry = async (res: any) => {
							if (res.status === 429 && numRetries < 2) {
								numRetries += 1
								await new Promise((resolve) => setTimeout(resolve, 3e3))
								return fetch(url, { credentials: "include" })
							}

							return res
						}

						promise = promises[url] = fetch(url, { credentials: "include" })
							.then(tryRetry)
							.then((res) => (res.ok ? res.json() : null))
							.catch(() => null)
							.finally(() => delete promises[url])
					}

					const json = await promise

					if (!json) {
						throw new Error("Failed to load")
					}

					const maxServer = (largePageIndex - 1) * largePageSize + json.data.length
					const maxPage = Math.max(1, Math.floor((maxServer - 1) / pageSize) + 1)

					if (json.nextPageCursor) {
						cursors[largePageIndex - 1] = json.nextPageCursor

						if (maxPage >= btrPager.maxPage) {
							btrPager.maxPage = maxPage
							btrPager.foundMaxPage = false
							btrPager.hasMore = true
							btrPagerState.update()
						}
					} else {
						const isMaxPage = json.data.length > 0 || largePageIndex === 1

						if (isMaxPage || maxPage <= btrPager.maxPage) {
							btrPager.maxPage = maxPage
							btrPager.foundMaxPage = json.data.length > 0 || largePageIndex === 1
							btrPager.hasMore = false
							btrPagerState.update()
						}
					}

					return json
				}

				const updateMaxPage = async (placeId: number, skipPageIndex: number) => {
					const largePageIndex = Math.min(
						Math.floor((btrPager.maxPage * pageSize - 1) / largePageSize) + 1,
						cursors.length + (btrPager.foundMaxPage ? 1 : 0),
					)

					if (largePageIndex === skipPageIndex) {
						return
					}

					const attemptFindMaxPage = async () => {
						for (let i = largePageIndex; i >= 1; i--) {
							await loadLargePage(placeId, i)

							if (btrPager.foundMaxPage || btrPager.hasMore) {
								break
							}
						}
					}

					btrPager.updatingMaxPage = true
					btrPagerState.update()

					return attemptFindMaxPage().finally(() => {
						btrPager.updatingMaxPage = false
						btrPagerState.update()
					})
				}

				const loadServers = async (placeId: number) => {
					const largePages: Record<string, any> = {}

					outer: while (true) {
						const targetPage = btrPager.targetPage

						const serversFrom = (targetPage - 1) * pageSize + 1
						const serversTo = serversFrom + pageSize - 1

						const largeFrom = Math.min(
							cursors.length + 1,
							Math.floor((serversFrom - 1) / largePageSize) + 1,
						)
						let largeTo = Math.floor((serversTo - 1) / largePageSize) + 1

						for (let largePageIndex = largeFrom; largePageIndex <= largeTo; largePageIndex++) {
							const json = largePages[largePageIndex]

							if (!json) {
								largePages[largePageIndex] = await loadLargePage(placeId, largePageIndex)
								continue outer
							}

							if (!json.nextPageCursor) {
								const maxServer = (largePageIndex - 1) * largePageSize + json.data.length
								const maxPage = Math.max(1, Math.floor((maxServer - 1) / pageSize) + 1)

								if (maxPage < targetPage) {
									btrPager.targetPage = maxPage
									btrPagerState.update()
									continue outer
								}

								largeTo = largePageIndex
								break
							}
						}

						btrPager.currentPage = targetPage
						btrPagerState.update()

						const result: any[] = []

						for (let largePageIndex = largeFrom; largePageIndex <= largeTo; largePageIndex++) {
							const json = largePages[largePageIndex]
							const startIndex = (largePageIndex - 1) * largePageSize

							result.push(
								...json.data.slice(
									Math.max(0, serversFrom - 1 - startIndex),
									Math.max(0, serversTo - startIndex),
								),
							)
						}

						if (!btrPager.updatingMaxPage) {
							updateMaxPage(placeId, largeTo)
						}

						return result
					}
				}

				let getGameInstancesPromise: Promise<any> | null = null
				const btrGetPublicGameInstances = (placeId: number, cursor: string, params: any) => {
					if (!params?.btrRefresh) {
						const sortOrder = params?.sortOrder === "Asc" ? "Asc" : "Desc"
						const excludeFullGames = !!params?.excludeFullGames

						if (
							serverParams.sortOrder !== sortOrder ||
							serverParams.excludeFullGames !== excludeFullGames
						) {
							getGameInstancesPromise = null

							serverParams.sortOrder = sortOrder
							serverParams.excludeFullGames = excludeFullGames

							btrPager.targetPage = 1
						}
					}

					if (!getGameInstancesPromise) {
						btrPager.loading = true
						btrPagerState.update()

						const thisPromise = (getGameInstancesPromise = loadServers(placeId)
							.then(
								(servers) => ({
									data: {
										nextPageCursor:
											btrPager.currentPage < btrPager.maxPage ? "idk" : null,
										data: servers,
									},
								}),
								() => null,
							)
							.finally(() => {
								if (getGameInstancesPromise === thisPromise) {
									btrPager.loading = false
									btrPagerState.update()

									getGameInstancesPromise = null
								}
							}))
					}

					return getGameInstancesPromise
				}

				const btrPagerConstructor = ({
					refreshGameInstances,
				}: {
					refreshGameInstances: (...args: any[]) => any
				}) => {
					const btrPager = reactHook.useGlobalState(btrPagerState)

					const canPrev = !btrPager.loading && btrPager.currentPage > 1
					const canNext =
						!btrPager.loading &&
						(!btrPager.foundMaxPage || btrPager.currentPage < (btrPager.maxPage ?? 2))

					const inputRef = React.useRef()

					const updateInputWidth = () => {
						inputRef.current.style.width = "0px"
						inputRef.current.style.width = `${Math.max(32, Math.min(100, inputRef.current.scrollWidth + 12))}px`
					}

					React.useEffect(updateInputWidth, [])

					React.useEffect(() => {
						inputRef.current.value = btrPager.currentPage
					}, [btrPager.currentPage])

					const submit = (pressedEnter: boolean) => {
						const num = parseInt(inputRef.current.value, 10)

						if (Number.isSafeInteger(num) && (pressedEnter || btrPager.targetPage !== num)) {
							btrPager.targetPage = Math.max(1, num)
							refreshGameInstances({ btrRefresh: true })
						} else {
							inputRef.current.value = btrPager.currentPage
						}
					}

					return React.createElement(
						"div",
						{ className: "btr-pager-holder btr-server-pager" },
						React.createElement(
							"ul",
							{ className: "btr-pager" },

							React.createElement(
								"li",
								{ className: `btr-pager-first` },
								React.createElement(
									"button",
									{
										className: "btn-generic-first-page-sm",
										disabled: !canPrev,
										onClick() {
											if (!canPrev) {
												return
											}
											btrPager.targetPage = 1
											refreshGameInstances({ btrRefresh: true })
										},
									},
									React.createElement("span", { className: "icon-first-page" }),
								),
							),

							React.createElement(
								"li",
								{ className: `btr-pager-prev` },
								React.createElement(
									"button",
									{
										className: "btn-generic-left-sm",
										disabled: !canPrev,
										onClick() {
											if (!canPrev) {
												return
											}
											btrPager.targetPage = Math.max(1, btrPager.currentPage - 1)
											refreshGameInstances({ btrRefresh: true })
										},
									},
									React.createElement("span", { className: "icon-left" }),
								),
							),

							React.createElement(
								"li",
								{ className: `btr-pager-mid` },
								React.createElement("span", {}, "Page"),
								React.createElement("input", {
									className: "btr-pager-cur",
									type: "text",
									ref: inputRef,

									onChange() {
										updateInputWidth()
									},

									onKeyDown(e: any) {
										if (e.which === 13) {
											submit(true)
											e.target.blur()
										}
									},

									onBlur(_e: any) {
										submit(false)
									},
								}),
								React.createElement(
									"span",
									{},
									` of `,

									React.createElement(
										"span",
										{
											className: "btr-pager-total",
										},
										btrPager.foundMaxPage
											? `${btrPager.maxPage}`
											: btrPager.maxPage > 1
												? `${btrPager.maxPage}+`
												: "1",
									),
								),
							),

							React.createElement(
								"li",
								{ className: `btr-pager-next` },
								React.createElement(
									"button",
									{
										className: "btn-generic-right-sm",
										disabled: !canNext,
										onClick() {
											if (!canNext) {
												return
											}
											btrPager.targetPage = btrPager.currentPage + 1
											refreshGameInstances({ btrRefresh: true })
										},
									},
									React.createElement("span", { className: "icon-right" }),
								),
							),

							React.createElement(
								"li",
								{ className: `btr-pager-last` },
								React.createElement(
									"button",
									{
										className: "btn-generic-last-page-sm",
										disabled: !canNext,
										onClick() {
											if (!canNext) {
												return
											}
											btrPager.targetPage = Math.max(
												btrPager.maxPage ?? 1,
												btrPager.currentPage + 50,
											)
											refreshGameInstances({ btrRefresh: true })
										},
									},
									React.createElement("span", { className: "icon-last-page" }),
								),
							),
						),
					)
				}

				const globalServerRegions: Record<string, any> = {}
				const onRegionsChanged = new Set()

				contentScript.listen("setServerRegion", (jobId, details) => {
					globalServerRegions[jobId] = details

					for (const fn of onRegionsChanged) {
						;(fn as any)()
					}
				})

				const regionSetting = settings.gamedetails.showServerRegion
				const addServerPager = settings.gamedetails.addServerPager

				reactHook.hijackConstructor(
					(props: any) => props.getGameServers,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]

						if (addServerPager && props.type === "public") {
							props.getGameServers = btrGetPublicGameInstances
						}

						return target.apply(thisArg, args)
					},
				)

				reactHook.hijackConstructor(
					(props: any) => props.loadMoreGameInstances && "headerTitle" in props,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]

						if (addServerPager && props.type === "public") {
							props.btrPagerEnabled = true
							props.showLoadMoreButton = false
						}

						const result = target.apply(thisArg, args)

						try {
							const list = reactHook.queryElement(result, (x: any) =>
								x.props.id?.includes("running-games"),
							)

							if (props.btrPagerEnabled) {
								list.props.children.push(
									React.createElement(btrPagerConstructor, {
										refreshGameInstances: props.refreshGameInstances,
									}),
								)
							}

							const ul = reactHook.queryElement(list, (x: any) => x.type === "ul", 5)
							const servers = ul?.props?.children

							if (servers) {
								for (const server of [servers].flat()) {
									if (server?.props) {
										server.props.ping = props?.gameInstances?.find(
											(x: any) => x.id === server.props.id,
										)?.ping
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
					// GameInstanceCard
					(props: any) => props.gameServerStatus,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]
						const placeId = props.placeId
						const jobId = props.id

						const result = target.apply(thisArg, args)

						try {
							// add context menu entry to copy jobid
							const joinBtn = reactHook.queryElement(result, (x: any) =>
								x.props.className?.includes("game-server-join-btn"),
							)
							if (joinBtn) {
								joinBtn.props["data-btr-instance-id"] = jobId
							}

							// add region/ping label
							const status =
								regionSetting !== "none" &&
								reactHook.queryElement(result, (x: any) =>
									x.props.className?.includes("rbx-game-status"),
								)
							if (status) {
								if (regionSetting !== "region") {
									status.props.children += `\nPing: ${props.ping ?? -1}ms`
								}

								if (regionSetting !== "ping") {
									const [serverDetails, setServerDetails] = React.useState(null)

									React.useEffect(() => {
										const details = globalServerRegions[jobId]

										setServerDetails(globalServerRegions[jobId])
										if (!details?.location) {
											contentScript.send("getServerRegion", placeId, jobId)
										}

										const callback = () => {
											setServerDetails(globalServerRegions[jobId])
										}

										onRegionsChanged.add(callback)
										return () => onRegionsChanged.delete(callback)
									}, [placeId, jobId])

									if (regionSetting === "combined") {
										status.props.children += ` (${
											!serverDetails
												? "Loading"
												: !serverDetails.location
													? serverDetails.statusText
													: serverDetails.location.country.code
										})`
									} else {
										status.props.children += `\nRegion: ${
											!serverDetails
												? "Loading"
												: !serverDetails.location
													? serverDetails.statusText
													: `${serverDetails.location.city}, ${
															serverDetails.location.country.name ===
															"United States"
																? serverDetails.location.region.code
																: serverDetails.location.country.code
														}`
										}`
									}

									status.props.title = !serverDetails
										? "Loading"
										: !serverDetails.location
											? serverDetails.statusTextLong
											: serverDetails.location.country.name === "United States"
												? `${serverDetails.location.city}, ${serverDetails.location.region.name}, ${serverDetails.location.country.name}`
												: `${serverDetails.location.city}, ${serverDetails.location.country.name}`

									if (serverDetails?.address) {
										status.props.title += ` (${serverDetails?.address})`
									}
								}
							}
						} catch (ex) {
							console.error(ex)
						}

						return result
					},
				)

				reactHook.hijackUseStateGlobal(
					(value: any, _index: number) =>
						["tab-about", "tab-game-instances", "tab-store"].includes(value),
					(value: any, _initial: any) => {
						if (value === "tab-about" && window.location.hash !== "#!/about") {
							return "tab-game-instances"
						}

						return value
					},
				)
			},
			gamedetails: () => {
				reactHook.inject(".game-description-container", (elem: any) => {
					elem.replaceWith(
						reactHook.createElement(
							"div",
							{ style: { display: "contents" } },
							reactHook.createElement(
								"div",
								{ id: "btr-description-wrapper", style: { display: "contents" } },
								elem[0],
							),
						),
					)
				})

				reactHook.inject(".container-list.games-detail", (elem: any) => {
					elem.replaceWith(
						reactHook.createElement(
							"div",
							{ style: { display: "contents" } },
							reactHook.createElement(
								"div",
								{ id: "btr-recommendations-wrapper", style: { display: "contents" } },
								elem[0],
							),
						),
					)
				})

				reactHook.inject(".game-social-links .btn-secondary-lg", (elem: any) => {
					const socials = reactHook.renderTarget?.state[0]?.[0]
					const entry = socials?.find((x: any) => x.id === +elem[0].key)

					if (entry) {
						elem[0].props.href = entry.url

						hijackFunction(elem[0].props, "onClick", (target: any, thisArg: any, args: any[]) => {
							const event = args[0]
							event.preventDefault()

							const result = target.apply(thisArg, args)
							return result
						})
					}
				})
			},
			gamedetailsPlayGame: (placeId: number) => {
				Roblox.GameLauncher.joinMultiplayerGame(placeId, true)
			},
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

							hijackFunction(
								$scope,
								"groupDetailsTabs",
								(target: any, thisArg: any, args: any[]) => {
									let result = target.apply(thisArg, args)

									const entries = Object.entries(result)

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
			favoritesAtTop: () => {
				hijackXHR((request: any) => {
					if (
						request.method === "POST" &&
						request.url.match(
							/^https:\/\/apis\.roblox\.com\/discovery-api\/omni-recommendation(-metadata)?$/i,
						)
					) {
						request.onResponse.push((json: any) => {
							if (settings.home.favoritesAtTop && json?.sorts) {
								const favoritesSort = json.sorts.find((x: any) => x.topicId === 100000001)
								const continueSort = json.sorts.find((x: any) => x.topicId === 100000003)

								if (favoritesSort) {
									json.sorts.splice(json.sorts.indexOf(favoritesSort), 1)
									json.sorts.splice(1, 0, favoritesSort)
								}

								if (continueSort) {
									json.sorts.splice(json.sorts.indexOf(continueSort), 1)
									json.sorts.splice(1, 0, continueSort)
								}
							}
						})
					}
				})
			},
			showRecommendationPlayerCount: () => {
				reactHook.hijackConstructor(
					(props: any) =>
						"wideTileType" in props && "gameData" in props && "playerCountStyle" in props,
					(target: any, thisArg: any, args: any[]) => {
						const props = args[0]
						props.playerCountStyle = "Footer"
						return target.apply(thisArg, args)
					},
				)
			},
			instantGameHoverAction: () => {
				reactHook.inject(".hover-game-tile.old-hover", (elem: any) => {
					const props = elem[0].props

					const [isFocused, setIsFocused] = reactHook.React.useState(false)

					props.className = (props.className ?? "").replace(/\bfocused\b/, "")
					props.className += " btr-game-hover-fix"

					if (isFocused) {
						props.className += " focused"
					}

					props.onMouseOver = new Proxy(props.onMouseOver ?? (() => {}), {
						apply(target: any, thisArg: any, args: any[]) {
							setIsFocused(true)
							return target.apply(thisArg, args)
						},
					})

					props.onMouseLeave = new Proxy(props.onMouseLeave ?? (() => {}), {
						apply(target: any, thisArg: any, args: any[]) {
							setIsFocused(false)
							return target.apply(thisArg, args)
						},
					})
				})
			},
			inventoryTools: () => {
				angularHook.hijackModule("inventory", {
					inventoryContentController(target: any, thisArg: any, args: any[], argsMap: any) {
						const result = target.apply(thisArg, args)

						try {
							const { $scope } = argsMap

							$scope.$watch("$ctrl.assets", () => {
								setTimeout(() => contentScript.send("inventoryUpdateEnd"), 0)
							})
						} catch (ex) {
							console.error(ex)
							if (IS_DEV_MODE) {
								alert("hijackAngular Error")
							}
						}

						return result
					},
				})
			},
			refreshInventory: () => {
				const scope = angular.element(document.querySelector("assets-explorer")).scope()
				const ctrl = scope?.$parent?.$ctrl

				if (ctrl) {
					const real1 = ctrl.cursorPager.loadPreviousPage
					const real2 = ctrl.assetsPager.canLoadPreviousPage

					ctrl.cursorPager.loadPreviousPage = ctrl.cursorPager.reloadCurrentPage
					ctrl.assetsPager.canLoadPreviousPage = () => true

					try {
						ctrl.assetsPager.loadPreviousPage()
					} catch (ex) {}

					ctrl.cursorPager.loadPreviousPage = real1
					ctrl.assetsPager.canLoadPreviousPage = real2
				}
			},
			itemdetails: () => {
				reactHook.hijackConstructor(
					(props: any) => "itemDetails" in props,
					(target: any, thisArg: any, args: any[]) => {
						const result = target.apply(thisArg, args)

						try {
							const props = args[0]

							if (result?.props?.className?.includes("item-details-info-header")) {
								const { itemDetails } = props

								result.props.children.splice(
									1,
									0,
									reactHook.createElement("div", {
										className: "btr-buttons",
										dangerouslySetInnerHTML: { __html: "" },

										"data-btr-asset-id": itemDetails.id,
										"data-btr-asset-type-id": itemDetails.assetType,
										"data-btr-item-type": itemDetails.itemType,
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
			refreshMessages: () => {
				const scope = angular
					.element(document.querySelector(`div[ng-controller="messagesController"]`))
					?.scope()

				if (scope) {
					scope.getMessages(scope.currentStatus.activeTab, scope.currentStatus.currentPage)
					scope.$digest()
				}
			},
			messages: () => {
				angularHook.hijackModule("messages", {
					messagesNav(target: any, thisArg: any, args: any[], argsMap: any) {
						const result = target.apply(thisArg, args)

						try {
							const { $location } = argsMap

							hijackFunction(result, "link", (target: any, thisArg: any, args: any[]) => {
								try {
									const [$state] = args

									$state.btr_setPage = ($event: any) => {
										const value = +$event.target.value

										if (!Number.isNaN(value)) {
											$location.search({ page: value })
											$event.target.value = value
										} else {
											$event.target.value = $state.currentStatus.currentPage
										}
									}
								} catch (ex) {
									console.error(ex)
									if (IS_DEV_MODE) {
										alert("hijackAngular Error")
									}
								}

								return target.apply(thisArg, args)
							})
						} catch (ex) {
							console.error(ex)
							if (IS_DEV_MODE) {
								alert("hijackAngular Error")
							}
						}

						return result
					},
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
			profile: () => {
				angularHook.hijackModule("peopleList", {
					layoutService(target: any, thisArg: any, args: any[], _argsMap: any) {
						const result = target.apply(thisArg, args)
						result.maxNumberOfFriendsDisplayed = 10
						return result
					},
				})

				reactHook.inject(">.profile-tab-content", (tabContent: any) => {
					for (const child of tabContent[0].props.children) {
						switch (child.key) {
							case "About":
							case "FavoriteExperiences":
							case "Communities":
							case "PlayerBadges":
							case "Statistics":
							case "Experiences":
							case "CreationsModels":
							case "Clothing":
								delete child.props.children
								break
							case "CurrentlyWearing":
							case "Collections":
							case "Friends":
							case "Store":
								break // do nothing (we do something with this)
							default:
								if (IS_DEV_MODE) {
									console.log(`Unknown component '${child.key}'`)
								}
						}
					}
				})

				hijackXHR((request: any) => {
					if (request.url === "https://apis.roblox.com/profile-platform-api/v1/profiles/get") {
						request.onResponse.push((json: any) => {
							contentScript.send("profileData", json)
						})
					}
				})
			},
			setupGamePopovers: (selector: string) => {
				Roblox?.BootstrapWidgets?.SetupPopover(null, null, selector)
			},
			linkify: (target: any) => $(target).linkify(),
			profilePlayGame: (placeId: number) => {
				Roblox.GameLauncher.joinMultiplayerGame(placeId, true)
			},
			profileEditPlace: (gameId: number, placeId: number) => {
				Roblox.GameLauncher.editGameInStudio(placeId, gameId)
			},
			"adblock.js": () => {
				util.ready(() => {
					if (window.Roblox?.PrerollPlayer) {
						window.Roblox.PrerollPlayer.waitForPreroll = (x: any) => $.Deferred().resolve(x)
					}

					if (window.Roblox?.VideoPreRollDFP) {
						window.Roblox.VideoPreRollDFP = null
					}
				})
			},
			fastsearchFollowPlayer: (userId: number) => {
				Roblox.GameLauncher.followPlayerIntoGame(userId)
			},
			fastsearch: () => {
				reactHook.inject("#navbar-universal-search, .navbar-search", (elem: any) => {
					elem.find("ul")?.prepend(
						reactHook.createElement("div", {
							id: "btr-fastsearch-container",
							dangerouslySetInnerHTML: { __html: "" },
						}),
					)
				})
			},
			voiceStatus: () => {
				reactHook.inject("ul.navbar-right", (elem: any) => {
					const placeholder = () =>
						reactHook.createElement("div", {
							id: "btr-placeholder-voice",
							style: { display: "none" },
							dangerouslySetInnerHTML: { __html: "" },
						})

					// Sits between search and the notification bell. Falling back to
					// robux only loses the placement, not the feature.
					const search = elem.find((x: any) => "toggleUniverseSearch" in x.props)

					if (search) {
						search.after(placeholder())
					} else {
						elem.find((x: any) => "robuxAmount" in x.props)?.before(placeholder())
					}
				})
			},
			// Roblox's chat renders an open conversation from a react-query cache
			// that nothing invalidates when a message arrives. The conversation
			// object gets a fresh preview, so the list updates and the unread
			// badge appears, while the messages themselves stay as they were
			// until the page is reloaded.
			//
			// Refetching that query is all it takes, so this watches the open
			// conversations and invalidates one when its preview moves on
			// without its messages following.
			fixChatMessages: () => {
				const SHELL = ".react-chat-dialog-shell"
				const ROW = "button.react-chat-row"
				const seen = new Map<string, string>()

				const fiberOf = (node: any) => {
					const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
					return key ? node[key] : null
				}

				/** Walks up from a node until a fiber carries the named prop. */
				const propAbove = (node: any, name: string, test?: (value: any) => boolean) => {
					let fiber = fiberOf(node)

					for (let depth = 0; fiber && depth < 40; depth++) {
						const value = fiber.memoizedProps?.[name]

						if (value && (!test || test(value))) {
							return value
						}

						fiber = fiber.return
					}

					return null
				}

				const conversationOf = (node: any) => propAbove(node, "conversation", (c) => !!c.id)

				const check = () => {
					if (settings.general?.fixChatMessages === false) {
						return
					}

					// Read from the list rows, not from the open conversation. The
					// conversation is the component that is not re-rendering, so its
					// props still describe the state before the message arrived. The
					// rows do re-render, which is why the list and the unread badge
					// are right while the messages are not.
					// Falling back to the conversations themselves keeps this working,
					// just not promptly, if the rows ever stop carrying one.
					const sources = document.querySelectorAll(ROW).length
						? document.querySelectorAll(ROW)
						: document.querySelectorAll(SHELL)

					for (const row of sources) {
						try {
							const conversation = conversationOf(row)
							if (!conversation) {
								continue
							}

							const preview = String(conversation.preview?.text ?? conversation.preview ?? "")
							if (!preview || seen.get(conversation.id) === preview) {
								continue
							}

							// Only conversations that are open on screen can be showing
							// stale messages.
							const shell = [...document.querySelectorAll(SHELL)].find(
								(s) => conversationOf(s)?.id === conversation.id,
							)

							if (!shell) {
								continue
							}

							const client = propAbove(shell, "client", (c) => !!c.invalidateQueries)
							if (!client) {
								continue
							}

							// A conversation that has not rendered anything yet is loading,
							// not behind. Invalidating then would cancel its first fetch
							// and race the thing it is meant to help.
							const rendered = shell.querySelectorAll("li").length

							if (!rendered || shell.textContent?.includes(preview)) {
								continue
							}

							// Recorded before invalidating, so the refetch this causes
							// cannot come back around and invalidate again.
							seen.set(conversation.id, preview)

							// Matched by looking for the conversation id inside the key
							// rather than by rebuilding roblox's key shape, which is
							// theirs to change.
							client.invalidateQueries({
								predicate: (query: any) => {
									try {
										return JSON.stringify(query.queryKey).includes(conversation.id)
									} catch {
										return false
									}
								},
							})
						} catch {}
					}
				}

				// The list re-renders when a message lands even though the
				// conversation does not, so watching the chat covers the case
				// without polling for it.
				let watched: Element | null = null

				const inner = new MutationObserver(() => {
					if (watched && !watched.isConnected) {
						// The chat was torn down, so go back to waiting for a new one
						// rather than holding an observer on a detached tree.
						inner.disconnect()
						watched = null
						outer.observe(document, { childList: true, subtree: true })
						return
					}

					check()
				})

				// Watching the whole document is only to find the chat once. It is
				// the busiest observer on the page, so it stops as soon as it has.
				const outer = new MutationObserver(() => {
					const root = document.querySelector(".react-chat-root")

					if (!root || root === watched) {
						return
					}

					watched = root
					outer.disconnect()
					inner.observe(root, { childList: true, subtree: true, characterData: true })
					check()
				})

				outer.observe(document, { childList: true, subtree: true })
			},
			navigation: () => {
				reactHook.inject("ul.navbar-right", (elem: any) => {
					const robux = elem.find((x: any) => "robuxAmount" in x.props)

					if (robux) {
						robux.before(
							reactHook.createElement("div", {
								id: "btr-placeholder-friends",
								style: { display: "none" },
								dangerouslySetInnerHTML: { __html: "" },
							}),
							reactHook.createElement("div", {
								id: "btr-placeholder-messages",
								style: { display: "none" },
								dangerouslySetInnerHTML: { __html: "" },
							}),
						)
					}
				})

				reactHook.inject(".left-col-list", (elem: any) => {
					const trade = elem.find((x: any) => x.key === "trade")
					if (trade) {
						trade.after(
							reactHook.createElement("div", {
								id: "btr-placeholder-money",
								style: { display: "none" },
								dangerouslySetInnerHTML: { __html: "" },
							}),
						)
					}

					const blog = elem.find((x: any) => x.key === "blog")
					if (blog) {
						blog.before(
							reactHook.createElement("div", {
								id: "btr-placeholder-premium",
								style: { display: "none" },
								dangerouslySetInnerHTML: { __html: "" },
							}),
						)

						blog.after(
							reactHook.createElement("div", {
								id: "btr-placeholder-blogfeed",
								style: { display: "none" },
								dangerouslySetInnerHTML: { __html: "" },
							}),
						)
					}
				})
			},
			// Stop inserting injected functions here
		}

		// Hooks that install a react or angular interception. They must be
		// registered before Roblox renders, and registering one twice would apply
		// its transform twice, so the content script calling later is a no op.
		//
		// Only put a hook here if it installs something. Anything that acts on the
		// current DOM belongs on demand: listing it here runs it once at
		// document_start, when there is nothing to act on, and the dedupe below
		// then swallows every later call. setupPopovers, refreshInventory and
		// refreshMessages were all silently dead that way.
		const EAGER_HOOKS = [
			"avatar",
			"assetRefinement",
			"fullRangeBodyColors",
			"showOwnedAssets",
			"initReactRobuxToCash",
			"addBTRSettings",
			"cacheRobuxAmount",
			"higherRobuxPrecision",
			"hideFriendActivity",
			"ignoreR6Warning",
			"hijackAuth",
			"webpackHook",
			"removeAccessoryLimits",
			"createAddBTRSettings",
			"createAssetOptions",
			"createDownloadVersion",
			"marketplacePageChanged",
			"gamedetails",
			"groupsModifyLayout",
			"showRecommendationPlayerCount",
			"instantGameHoverAction",
			"inventoryTools",
			"itemdetails",
			"messages",
			"money",
			"profile",
			"adblock.js",
			"fastsearch",
			"fixChatMessages",
			"navigation",
			"voiceStatus",
		]

		// These read settings, so they cannot run until init has delivered them.
		const SETTINGS_HOOKS = ["initReactFriends", "experiments", "pagedServers", "favoritesAtTop"]

		const registered = new Set<string>()

		const callInjected = (name: string, args: any[] = []) => {
			const isRegistration = EAGER_HOOKS.includes(name) || SETTINGS_HOOKS.includes(name)

			if (isRegistration) {
				if (registered.has(name)) {
					return
				}
				registered.add(name)
			}

			try {
				injectedFunctions[name](...args)
			} catch (ex) {
				// The dev probe hooks the content script's console, not this one,
				// so a hook failing in here was invisible. Keep the failures where
				// the bridge can read them.
				if (__DEV__) {
					try {
						const errors = ((globalThis as any).__btrInjectErrors ??= [])
						errors.push(name + ": " + ((ex as Error)?.stack || ex))
					} catch {}
				}

				console.error("[btr] injected function " + name + " failed", ex)
			}
		}

		contentScript.listen("call", (name: string, args: any[]) => {
			callInjected(name, args)
		})

		for (const name of EAGER_HOOKS) {
			callInjected(name)
		}

		applySettings = (newSettings, isDevMode, cashOption) => {
			pageSettings = newSettings
			IS_DEV_MODE = isDevMode
			selectedRobuxToCashOption = cashOption
			RobuxToCash.selectedRobuxToCashOption = cashOption

			for (const name of SETTINGS_HOOKS) {
				callInjected(name)
			}
		}

		//

		contentScript.listen("setCurrentPage", (_currentPage) => {
			currentPage = _currentPage
		})

		// init only fires once, so without this the page world would keep running
		// against the settings it booted with. Every hook that reads through the
		// settings proxy per call picks changes up from here with no reload.
		contentScript.listen("updateSettings", (newSettings: any, cashOption: any) => {
			pageSettings = newSettings
			selectedRobuxToCashOption = cashOption
			RobuxToCash.selectedRobuxToCashOption = cashOption
		})

		reactHook.init()
		angularHook.init()
	}
}

startInject()

document.addEventListener(
	"btroblox/init",
	(ev) => {
		const [newSettings, isDevMode, cashOption] = (ev as CustomEvent).detail
		applySettings?.(newSettings, isDevMode, cashOption)
	},
	{ once: true },
)
