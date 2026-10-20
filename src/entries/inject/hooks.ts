// Function, property and network interception that the page world hooks are built on.

export const util = {
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

export const onSet = (a: any, b: any, c: any) => {
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

export const hijackFunction = (...args: any[]) => {
	if (args.length === 2) {
		return new Proxy(args[0], { apply: args[1] })
	}

	return (args[0][args[1]] = new Proxy(args[0][args[1]], { apply: args[2] }))
}

const xhrTransforms: any[] = []

export const hijackXHR = (fn: (...args: any[]) => any) => {
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
					// The handlers run once, on whichever of responseText and
					// response the page reads first. Angular reads response, so
					// hooking responseText alone missed every Angular request.
					let transformed: { text: string; json: any } | null = null
					const descriptors: Record<string, PropertyDescriptor> = {}

					const native = (prop: string) => {
						delete xhr[prop]
						const value = xhr[prop]
						Object.defineProperty(xhr, prop, descriptors[prop])
						return value
					}

					const transform = () => {
						if (transformed || xhr.readyState !== 4) {
							return transformed
						}

						let json: any

						try {
							json =
								xhr.responseType === "json"
									? native("response")
									: JSON.parse(native("responseText"))
						} catch {
							return null
						}

						// Bare values pass too, such as the favorite count, which
						// is a plain number.
						if (json === null) {
							return null
						}

						for (const fn of request.onResponse) {
							try {
								;(fn as any)(json, request)
							} catch (ex) {
								console.error(ex)
							}
						}

						transformed = { text: JSON.stringify(json), json }
						return transformed
					}

					const isText = () => xhr.responseType === "" || xhr.responseType === "text"

					descriptors.responseText = {
						configurable: true,
						get() {
							return (isText() && transform()?.text) || native("responseText")
						},
					}

					descriptors.response = {
						configurable: true,
						get() {
							if (isText()) {
								return transform()?.text ?? native("response")
							}

							if (xhr.responseType === "json") {
								return transform()?.json ?? native("response")
							}

							return native("response")
						},
					}

					Object.defineProperty(xhr, "responseText", descriptors.responseText)
					Object.defineProperty(xhr, "response", descriptors.response)
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
