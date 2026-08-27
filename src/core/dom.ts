// Microtask-scheduled callbacks, cancellable before they run.

const immediates = new Map<number, () => void>()
const resolved = Promise.resolve()

let immediateCounter = 0

export const setImmediate = <A extends unknown[]>(fn: (...args: A) => void, ...args: A): number => {
	const key = immediateCounter++
	immediates.set(key, () => fn(...args))

	void resolved.then(() => {
		const pending = immediates.get(key)
		if (!pending) {
			return
		}

		immediates.delete(key)
		pending()
	})

	return key
}

export const clearImmediate = (key: number): void => {
	immediates.delete(key)
}

// A single shared observer fanning out to every listener.

export interface DomListener {
	connected: boolean
	disconnect(): void
}

const domListeners: (DomListener & { callback: () => void })[] = []

let domObserver: MutationObserver | null = null

const flushDom = (): void => {
	for (let index = domListeners.length; index--;) {
		const listener = domListeners[index]

		if (!listener.connected) {
			domListeners.splice(index, 1)
			continue
		}

		try {
			listener.callback()
		} catch (err) {
			console.error("[btr] onDomChanged listener failed", err)
		}
	}

	if (!domListeners.length) {
		domObserver?.disconnect()
		domObserver = null
	}
}

export const onDomChanged = (callback: () => void): DomListener => {
	const listener = {
		callback,
		connected: true,
		disconnect() {
			this.connected = false
		},
	}

	if (!domObserver) {
		domObserver = new MutationObserver(flushDom)
		domObserver.observe(document.documentElement, { childList: true, subtree: true })
	}

	domListeners.push(listener)
	return listener
}
