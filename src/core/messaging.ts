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

interface PendingRequest {
	request: PortRequest
	callback: MessageCallback
	answered: boolean
	resent: boolean
}

export const backgroundScript: any = {
	pending: {} as Record<number, PendingRequest>,
	responseCounter: 0,

	resetTimeout() {
		if (this.portTimeout) {
			clearTimeout(this.portTimeout)
			this.portTimeout = null
		}

		if (this.port && Object.keys(this.pending).length === 0) {
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

			if (this.port === port) {
				this.port = null
				this.onPortLost()
			}
		})

		this.resetTimeout()
	},

	disconnectPort() {
		if (!this.port) {
			return
		}
		this.port.disconnect()
		this.port = null

		this.onPortLost()
	},

	/**
	 * The background stops when idle and takes its port along, with whatever it
	 * had not answered yet. Those are asked once more on a new port; the rest,
	 * and any whose reply had begun, end with no value rather than waiting for
	 * good.
	 */
	onPortLost() {
		const lost = Object.entries(this.pending as Record<number, PendingRequest>)
		this.pending = {}

		for (const [id, entry] of lost) {
			if (!entry.answered && !entry.resent) {
				entry.resent = true
				this.pending[Number(id)] = entry
			}
		}

		if (Object.keys(this.pending).length > 0) {
			this.initPort()
		}

		for (const [id, entry] of lost) {
			if (this.port && this.pending[Number(id)] === entry) {
				this.port.postMessage(entry.request)
				continue
			}

			delete this.pending[Number(id)]
			entry.callback(undefined)
		}

		this.resetTimeout()
	},

	onPortMessage(port: chrome.runtime.Port, msg: PortResponse) {
		const entry = this.pending[msg.id]
		if (!entry) {
			return
		}

		entry.answered = true

		if (msg.final) {
			delete this.pending[msg.id]
			this.resetTimeout()

			if (msg.cancel) {
				return
			}
		}

		entry.callback(msg.data)
	},

	send(name: string, data?: any, callback?: MessageCallback) {
		if (typeof data === "function") {
			callback = data
			data = null
		}

		const info: PortRequest = { name, data }

		if (!this.port) {
			this.initPort()
		}

		if (typeof callback === "function") {
			// No port means the extension was reloaded under this page, and no
			// answer will ever come.
			if (!this.port) {
				const done = callback
				queueMicrotask(() => done(undefined))
				return
			}

			const id = (info.id = this.responseCounter++)
			this.pending[id] = { request: info, callback, answered: false, resent: false }
		}

		if (this.port) {
			this.port.postMessage(info)
			this.resetTimeout()
		}
	},
}

export const injectScript: any = {
	messageListeners: {},

	/** Runs the inject.ts injectedFunctions entry of this name in the page. */
	call(name: string, ...args: any[]) {
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

		// A handler that fails would otherwise leave the caller waiting for good.
		const fail = (err: unknown) => {
			console.error(err)
			respond(undefined)
		}

		try {
			const result: any = listener(msg.data, respond, port)

			if (typeof result?.then === "function") {
				result.then(undefined, fail)
			}
		} catch (err) {
			fail(err)
		}
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
