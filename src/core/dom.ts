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

// Scrolling inside our popups.

/** Whether `element` can scroll any further by `delta` along one axis. */
const canScrollBy = (element: HTMLElement, delta: number, vertical: boolean): boolean => {
	const overflow = getComputedStyle(element)[vertical ? "overflowY" : "overflowX"]

	if (overflow !== "auto" && overflow !== "scroll") {
		return false
	}

	const position = vertical ? element.scrollTop : element.scrollLeft
	const room = vertical
		? element.scrollHeight - element.clientHeight
		: element.scrollWidth - element.clientWidth

	return delta < 0 ? position > 0 : position < room - 1
}

// Which way each scrolling key moves, down or right being positive.
const SCROLL_KEYS: Record<string, number> = {
	ArrowDown: 1,
	ArrowUp: -1,
	PageDown: 1,
	PageUp: -1,
	End: 1,
	Home: -1,
	" ": 1,
}

/**
 * Keeps the mouse wheel inside `root`. A list in it scrolls as usual, but at
 * its end, or over a part that doesn't scroll, nothing behind `root` moves:
 * neither the page nor, for a menu inside the settings, the settings.
 *
 * With `covers`, for a panel over the whole page, the scrolling keys are kept
 * in too while it shows. The page isn't locked by setting overflow on <html>:
 * Firefox rebuilds the whole page's layout for that, on every open and close.
 */
export const trapScroll = (root: HTMLElement, options: { covers?: boolean } = {}): void => {
	if (options.covers) {
		const onKey = (ev: KeyboardEvent) => {
			if (!root.isConnected) {
				document.removeEventListener("keydown", onKey, true)
				return
			}

			const direction = SCROLL_KEYS[ev.key]

			if (
				!direction ||
				ev.defaultPrevented ||
				ev.altKey ||
				ev.ctrlKey ||
				ev.metaKey ||
				!root.classList.contains("btr-settings-open") ||
				getComputedStyle(root).display === "none"
			) {
				return
			}

			const target = ev.target instanceof Element ? ev.target : null

			// Typing, and Space pressing a button, are left alone.
			if (
				target?.closest("input, textarea, select, [contenteditable]") ||
				(ev.key === " " &&
					target?.closest("button, a, summary, [role=button], [role=switch], [role=tab]"))
			) {
				return
			}

			for (
				let element = target && root.contains(target) ? target : null;
				element;
				element = element.parentElement
			) {
				if (element instanceof HTMLElement && canScrollBy(element, direction, true)) {
					return
				}

				if (element === root) {
					break
				}
			}

			ev.preventDefault()
		}

		document.addEventListener("keydown", onKey, true)
	}

	root.addEventListener(
		"wheel",
		(ev: WheelEvent) => {
			// Ctrl and the wheel zoom the page, which is not ours to stop.
			if (ev.ctrlKey || ev.defaultPrevented) {
				return
			}

			const vertical = Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)
			const delta = vertical ? ev.deltaY : ev.deltaX

			for (let element = ev.target as Element | null; element; element = element.parentElement) {
				if (element instanceof HTMLElement && canScrollBy(element, delta, vertical)) {
					return
				}

				if (element === root) {
					break
				}
			}

			ev.preventDefault()
		},
		{ passive: false },
	)
}
