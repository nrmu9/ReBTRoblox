import { onSet, hijackFunction } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { healthKey, healthHit, health } from "@/entries/inject/health"

// Hooks into Angular modules and template caches as Roblox registers them.

export const angularHook: Record<string, any> = {
	templateListeners: {},
	cachedTemplates: {},
	templateCaches: [],

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

	hijackModule(moduleName: string, objects: any) {
		if (health) {
			const counted: Record<string, any> = {}

			for (const [name, callback] of Object.entries(objects) as [string, any][]) {
				const key = healthKey(`angular ${moduleName}.${name}`)

				counted[name] = function (this: any, ...args: any[]) {
					if (__DEV__) {
						healthHit(key)
					}
					return callback.apply(this, args)
				}
			}

			objects = counted
		}

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

	initModule(module: any) {
		if (this.loadedModules[module.name] === module) {
			return
		}
		this.loadedModules[module.name] = module

		if (module.name === "ng") {
			// Behold the monstrosity~

			hijackFunction(module._configBlocks[0][2][0], 1, (target: any, thisArg: any, args: any[]) => {
				hijackFunction(args[0], "provider", (target: any, thisArg: any, args: any[]) => {
					if (args[0] instanceof Object && "$templateCache" in args[0]) {
						args[0].$templateCache = new Proxy(args[0].$templateCache, {
							construct: (target, args) => {
								const result = new target(...args)

								hijackFunction(result.$get, 1, (target: any, thisArg: any, args: any[]) => {
									const cache = target.apply(thisArg, args)
									this.templateCaches.push(cache)

									hijackFunction(cache, "put", (target: any, thisArg: any, args: any[]) => {
										const key = args[0]

										if (this.templateListeners[key]) {
											delete this.templateListeners[key]
											contentScript.send("initTemplate", key, args[1])
										}

										if (this.cachedTemplates[key]) {
											args[1] = this.cachedTemplates[key]
										}

										return target.apply(thisArg, args)
									})

									return cache
								})

								return result
							},
						})
					}

					return target.apply(thisArg, args)
				})

				return target.apply(thisArg, args)
			})
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
