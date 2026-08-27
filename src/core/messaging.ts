import { IS_BACKGROUND_PAGE, IS_FIREFOX } from "@/core/env"

declare const cloneInto: any

/** Anything crossing a port or a CustomEvent boundary is untyped by nature. */
type MessageCallback = (...args: any[]) => void

/** Content script to background: a named call, with an id when a reply is wanted. */
interface PortRequest {
	name: string
	data?: any
	id?: number
}

/** Background back to the content script. Replies may stream, hence `final`. */
interface PortResponse {
	id: number
	data?: any
	final?: boolean
	cancel?: boolean
}

export const backgroundScript: any = {
	callbacks: {},
	responseCounter: 0,

	resetTimeout() {
		if (this.portTimeout) {
			clearTimeout(this.portTimeout)
			this.portTimeout = null
		}

		if (this.port && Object.keys(this.callbacks).length === 0) {
			this.portTimeout = setTimeout(() => this.disconnectPort(), 10e3)
		}
	},

	initPort() {
		if (this.port) {
			return
		}
		if (!chrome.runtime?.id) {
			return
		} // dont try to create a port if extension context is invalidated

		const port = chrome.runtime.connect()
		this.port = port

		port.onMessage.addListener((msg) => this.onPortMessage(port, msg))
		port.onDisconnect.addListener(() => {
			void chrome.runtime.lastError // reading it is what clears it
			this.disconnectPort()
		})

		this.resetTimeout()
	},

	disconnectPort() {
		if (!this.port) {
			return
		}
		this.port.disconnect()
		this.port = null

		this.callbacks = {}
		this.resetTimeout()
	},

	onPortMessage(port: chrome.runtime.Port, msg: PortResponse) {
		const fn = this.callbacks[msg.id]
		if (!fn) {
			return
		}

		if (msg.final) {
			delete this.callbacks[msg.id]
			this.resetTimeout()

			if (msg.cancel) {
				return
			}
		}

		fn(msg.data)
	},

	send(name: string, data?: any, callback?: MessageCallback) {
		if (typeof data === "function") {
			callback = data
			data = null
		}

		const info: { name: string; data: any; id?: number } = { name, data }

		if (typeof callback === "function") {
			const id = (info.id = this.responseCounter++)
			this.callbacks[id] = callback
		}

		if (!this.port) {
			this.initPort()
		}
		if (this.port) {
			this.port.postMessage(info)
			this.resetTimeout()
		}
	},
}

export const injectScript: any = {
	messageListeners: {},

	call(name: string, fn: MessageCallback, ...args: any[]) {
		this.send("call", name, args)
	},

	send(action: string, ...args: any[]) {
		document.dispatchEvent(
			new CustomEvent(`btroblox/inject/${action}`, {
				detail: IS_FIREFOX
					? cloneInto(args, window, { cloneFunctions: true, wrapReflectors: true })
					: args,
			}),
		)
	},

	listen(action: string, callback: MessageCallback, params?: { once?: boolean | undefined }) {
		let listeners = this.messageListeners[action]

		if (!listeners) {
			listeners = this.messageListeners[action] = []

			document.addEventListener(
				`btroblox/content/${action}`,
				(ev: Event) => {
					let args

					try {
						args = IS_FIREFOX
							? cloneInto((ev as CustomEvent).detail, window, {
									cloneFunctions: true,
									wrapReflectors: true,
								})
							: (ev as CustomEvent).detail
					} catch (ex) {}

					args = Array.isArray(args) ? args : []

					for (let i = listeners.length; i--;) {
						try {
							listeners[i].apply(null, args)
						} catch (ex) {
							console.error(ex)
						}
					}
				},
				{ once: params?.once ?? false },
			)
		}

		listeners.push(callback)
	},

	init(...args: any[]) {
		document.dispatchEvent(
			new CustomEvent(`btroblox/init`, {
				detail: IS_FIREFOX
					? cloneInto(args, window, { cloneFunctions: true, wrapReflectors: true })
					: args,
			}),
		)
	},
}

// Background side. Content scripts connect to this over a port.

export const contentScript: any = {
	listenersByName: [],
	ports: [],

	onPortAdded(port: chrome.runtime.Port) {
		this.ports.push(port)

		port.onMessage.addListener((msg: PortRequest) => this.onPortMessage(port, msg))
		port.onDisconnect.addListener(() => this.onPortRemoved(port))
	},

	onPortRemoved(port: chrome.runtime.Port) {
		const index = this.ports.indexOf(port)
		if (index !== -1) {
			this.ports.splice(index, 1)
		}
	},

	onPortMessage(port: chrome.runtime.Port, msg: PortRequest) {
		const listener = this.listenersByName[msg.name]

		if (!listener) {
			throw new Error(`Received unknown message ${msg.name}`)
		}

		let final = false

		const respond = (response: any, hasMore?: boolean) => {
			if (!final && "id" in msg) {
				final = !(hasMore === true)

				port.postMessage({
					id: msg.id,
					data: response,
					final,
				})
			}
		}

		respond.cancel = () => {
			if (!final && "id" in msg) {
				final = true
				port.postMessage({ id: msg.id, final, cancel: true })
			}
		}

		listener(msg.data, respond, port)
	},

	listen(name: string, callback: MessageCallback) {
		if (typeof name === "object") {
			for (const [key, fn] of Object.entries(name) as [string, any][]) {
				this.listen(key, fn)
			}
			return
		}

		if (!this.listenersByName[name]) {
			this.listenersByName[name] = callback
		} else {
			console.warn(`Listener '${name}' already exists`)
		}
	},
}

if (IS_BACKGROUND_PAGE) {
	chrome.runtime.onConnect.addListener((port) => contentScript.onPortAdded(port))
}
