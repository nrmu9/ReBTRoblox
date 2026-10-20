import { onSet, hijackFunction, util } from "@/entries/inject/hooks"
import { healthKey, healthHit } from "@/entries/inject/health"

// Hooks into React element creation, rendering and state, with a small selector syntax to
// find elements by.

export const reactHook: Record<string, any> = {
	cachedSelectors: {},
	constructorProxies: new WeakMap(),
	constructorReplaces: [],
	injectedContent: [],
	globalHijackState: [],
	renderTarget: null as any,

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
					result.push(obj)
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
				(typeof elem.type !== "string" || selector.type.toLowerCase() !== elem.type.toLowerCase())
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
					const result = this._queryList([child.props.children], newSelectors, depth - 1, all, path)
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

		return this._queryList([element.props.children], selectors, depth, false, path ? [element] : null)
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
								if (force === true || (force !== false && !this.classList.contains(input))) {
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

	hijackConstructor(filter: (...args: any[]) => any, handler: (...args: any[]) => any) {
		const info = {
			index: this.constructorReplaces.length,
			filter,
			handler,
			healthKey:
				__DEV__ && healthKey(`constructor ${String(filter).replace(/\s+/g, " ").slice(0, 90)}`),

			remove() {
				;(this as any).removed = true
			},
		}

		this.constructorReplaces.push(info)
		return info
	},

	hijackUseState(filter: (...args: any[]) => any, transform: (...args: any[]) => any, permanent: boolean) {
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
		const parsed = this.parseReactSelector(selector)

		// One id or class per alternative that an element must carry to match
		// it. Checking for that string first lets onCreateElement skip the
		// full match for nearly every element React creates.
		const tokens: string[] = []

		for (const option of parsed) {
			const token = option.props?.id ?? option.classList?.[0]

			if (typeof token !== "string") {
				tokens.length = 0
				break
			}

			tokens.push(token)
		}

		this.injectedContent.push({
			healthKey: __DEV__ && healthKey(`inject ${selector}`),
			selector: parsed,
			tokens: tokens.length ? tokens : null,
			callback: callback,
		})
	},

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
				if (__DEV__) {
					healthHit(info.healthKey)
				}

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

		const props = result?.props

		if (!props) {
			return result
		}

		const className = typeof props.className === "string" ? props.className : ""
		const id = typeof props.id === "string" ? props.id : ""

		const root = [result]
		let wrapped

		outer: for (const content of this.injectedContent) {
			if (
				content.tokens &&
				!content.tokens.some((token: string) => token === id || className.includes(token))
			) {
				continue
			}

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

							if (__DEV__) {
								healthHit(content.healthKey)
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

						if (__DEV__) {
							healthHit(content.healthKey)
						}
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

	init() {
		onSet(window, "React", this.onReact.bind(this))
		onSet(window, "ReactJSX", (jsx: any) => {
			hijackFunction(jsx, "jsxs", this.onCreateElement.bind(this))
			hijackFunction(jsx, "jsx", this.onCreateElement.bind(this))
		})
	},
}
