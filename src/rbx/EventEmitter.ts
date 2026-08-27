// Minimal event emitter, subclassed by Avatar, Scene and the previewer.
//
// Listener state lives in a WeakMap rather than a field so that subclasses are
// free to define whatever instance properties they like without colliding.

type Listener = (...args: any[]) => void

interface ListenerOptions {
	once?: boolean
}

interface Registration {
	fn: Listener
	opt: ListenerOptions
}

interface EventProps {
	listeners: Record<string, Registration[] | undefined>
}

const EventMap = new WeakMap<object, EventProps>()

function getEventProps(item: object, init: true): EventProps
function getEventProps(item: object, init?: boolean): EventProps | null
function getEventProps(item: object, init?: boolean): EventProps | null {
	const existing = EventMap.get(item)
	if (existing) {
		return existing
	}

	if (init) {
		const props: EventProps = { listeners: {} }
		EventMap.set(item, props)
		return props
	}

	return null
}

export class EventEmitter {
	[key: string]: any

	on(eventName: string, fn: Listener, opt: ListenerOptions = {}): this {
		const props = getEventProps(this, true)
		const listeners = (props.listeners[eventName] ??= [])

		listeners.push({ fn, opt })

		return this
	}

	once(eventName: string, fn: Listener, opt: ListenerOptions = {}): this {
		opt.once = true
		return this.on(eventName, fn, opt)
	}

	off(eventName: string, fn: Listener): this {
		const props = getEventProps(this)
		const listeners = props?.listeners[eventName]
		if (!listeners) {
			return this
		}

		for (let i = listeners.length; i--;) {
			if (listeners[i].fn === fn) {
				listeners[i] = listeners[listeners.length - 1]
				listeners.pop()
			}
		}

		return this
	}

	trigger(eventName: string, ...args: unknown[]): void {
		const props = getEventProps(this)
		const listeners = props?.listeners[eventName]
		if (!listeners) {
			return
		}

		for (const x of listeners.slice()) {
			if (x.opt.once) {
				listeners.splice(listeners.indexOf(x), 1)
			}

			x.fn(...args)
		}
	}
}
