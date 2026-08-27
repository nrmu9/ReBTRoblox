// Event binding with optional delegation.
//
// Delegated handlers walk from the matched node up to the bound element, so one
// listener covers descendants that do not exist yet. The legacy version proxied
// stopPropagation and stopImmediatePropagation on every dispatch to detect
// cancellation; event.cancelBubble already reports both, so no proxies are needed.

type Handler = (event: Event, self: EventTarget) => void

interface Registered {
	selector: string
	callback: Handler
	options: AddEventListenerOptions
	params: [string, EventListener, AddEventListenerOptions]
}

const registry = new WeakMap<EventTarget, Map<string, Registered[]>>()

const normalize = (options: unknown): AddEventListenerOptions => {
	const out: AddEventListenerOptions =
		typeof options === "boolean"
			? { capture: options }
			: options && typeof options === "object"
				? { ...(options as AddEventListenerOptions) }
				: {}

	out.capture = out.capture === true
	return out
}

const listenersFor = (self: EventTarget, eventType: string, create: boolean): Registered[] | undefined => {
	let byType = registry.get(self)

	if (!byType) {
		if (!create) {
			return undefined
		}

		byType = new Map()
		registry.set(self, byType)
	}

	let listeners = byType.get(eventType)

	if (!listeners && create) {
		listeners = []
		byType.set(eventType, listeners)
	}

	return listeners
}

export const on = <T extends EventTarget>(
	self: T,
	eventType: string,
	selector: string | Handler | null,
	callback?: Handler | AddEventListenerOptions | boolean,
	options?: AddEventListenerOptions | boolean,
): T => {
	if (typeof selector === "function") {
		options = callback as AddEventListenerOptions | boolean
		callback = selector
		selector = null
	}

	if (selector !== null && typeof selector !== "string") {
		throw new TypeError("selector is not a string")
	}
	if (typeof callback !== "function") {
		throw new TypeError("callback is not a function")
	}

	const fn = callback as Handler
	const opts = normalize(options)

	if (!selector) {
		self.addEventListener(eventType, fn as EventListener, opts)
		return self
	}

	const target = self as unknown as Element
	const match = selector

	const handler = (event: Event): void => {
		let node = (event.target as Element | null)?.closest(match) ?? null
		if (!node || !target.contains(node)) {
			return
		}

		if (opts.once) {
			off(self, eventType, match, fn, opts)
		}

		do {
			Object.defineProperty(event, "currentTarget", { value: node, configurable: true })

			try {
				fn.call(self, event, self)
			} catch (err) {
				console.error("[btr] event handler failed", err)
			}

			delete (event as any).currentTarget

			if (event.cancelBubble) {
				break
			}

			node = node.parentElement ? node.parentElement.closest(match) : null
		} while (node && target.contains(node))
	}

	const registered: Registered = {
		selector: match,
		callback: fn,
		options: opts,
		params: [eventType, handler, opts.once ? { ...opts, once: false } : opts],
	}

	listenersFor(self, eventType, true)!.push(registered)
	self.addEventListener(...registered.params)

	return self
}

export const off = <T extends EventTarget>(
	self: T,
	eventType: string,
	selector: string | Handler | null,
	callback?: Handler | AddEventListenerOptions | boolean,
	options?: AddEventListenerOptions | boolean,
): T => {
	if (typeof selector === "function") {
		options = callback as AddEventListenerOptions | boolean
		callback = selector
		selector = null
	}

	if (selector !== null && typeof selector !== "string") {
		throw new TypeError("selector is not a string")
	}
	if (typeof callback !== "function") {
		throw new TypeError("callback is not a function")
	}

	const fn = callback as Handler
	const opts = normalize(options)

	if (!selector) {
		self.removeEventListener(eventType, fn as EventListener, opts)
		return self
	}

	const listeners = listenersFor(self, eventType, false)
	if (!listeners) {
		return self
	}

	for (let index = listeners.length; index--;) {
		const entry = listeners[index]

		if (entry.selector === selector && entry.callback === fn && entry.options.capture === opts.capture) {
			self.removeEventListener(...entry.params)
			listeners.splice(index, 1)
		}
	}

	if (!listeners.length) {
		registry.get(self)?.delete(eventType)
	}

	return self
}

export const trigger = <T extends EventTarget>(self: T, type: string, init?: EventInit): T => {
	self.dispatchEvent(new Event(type, init))
	return self
}
