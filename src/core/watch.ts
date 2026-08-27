// Chainable element watching.
//
// The legacy implementation kept a MutationObserver per target and re-ran
// querySelectorAll on every mutation. This delegates to core/hook, where the CSS
// engine does the matching, and keeps the same chainable surface.

import { watch as hookWatch } from "@/core/hook"
import { onDomChanged } from "@/core/dom"

export interface WatchProps {
	continuous?: boolean
}

type Filter = ((element: Element) => boolean) | null
type Callback = (...elements: any[]) => void

export interface Watcher {
	targetPromise: Promise<any>
	finishPromise: Promise<any> | null
	parent: Watcher | null

	$watch(
		selector: string | string[],
		filter?: Filter | Callback,
		callback?: Callback | WatchProps,
		props?: WatchProps,
	): Watcher
	$watchAll<T extends Element = HTMLElement>(
		selector: string,
		callback: (element: T, stop: () => void) => void,
		props?: WatchProps,
	): Watcher
	$then(callback?: (target: any) => void): Watcher
	$back(): Watcher
	$promise(): Promise<any>
}

const rootOf = (target: any): Element | Document =>
	target instanceof Document || target instanceof DocumentFragment
		? ((target as Document).documentElement ?? document)
		: target

const makeWatcher = (
	targetPromise: Promise<any>,
	finishPromise: Promise<any> | null,
	parent: Watcher | null,
): Watcher => ({
	targetPromise,
	finishPromise,
	parent,

	$watch(...args) {
		const next = this.targetPromise.then((target) => (watch as any)(target, ...args).finishPromise)
		return makeWatcher(this.targetPromise, next, this.parent)
	},

	$watchAll(...args) {
		void this.targetPromise.then((target) => (watchAll as any)(target, ...args))
		return this
	},

	$then(callback) {
		const next = makeWatcher(this.finishPromise ?? this.targetPromise, null, this)
		if (callback) {
			void next.targetPromise.then(callback)
		}
		return next
	},

	$back() {
		if (!this.parent) {
			throw new Error("Cannot call $back on a top level watcher")
		}
		return this.parent
	},

	$promise() {
		return this.finishPromise ?? this.targetPromise
	},
})

export const watch = (
	target: any,
	selectors: string | string[],
	filter?: Filter | Callback,
	callback?: Callback | WatchProps,
	props?: WatchProps,
): Watcher => {
	if (typeof callback !== "function") {
		props = callback as WatchProps
		callback = filter as Callback
		filter = null
	}

	const root = rootOf(target)
	const list = Array.isArray(selectors) ? selectors : [selectors]
	const test = filter as Filter
	const done = callback as Callback | undefined

	let finishPromise: Promise<any> | null = null

	if (props?.continuous) {
		if (list.length !== 1) {
			throw new TypeError("Multiple selectors with continuous watch")
		}

		// Delivery is synchronous for elements already present, so the disposer
		// cannot be a const referenced from inside the handler.
		let dispose: (() => void) | null = null

		const stop = (): void => dispose?.()

		dispose = hookWatch(
			list[0],
			(element) => {
				if (test && !test(element)) {
					return
				}

				try {
					done?.(element, stop)
				} catch (err) {
					console.error("[btr] watch callback failed", err)
				}
			},
			{ root },
		)
	} else {
		const promises = list.map(
			(selector) =>
				new Promise<Element>((resolve) => {
					// Delivery is synchronous for elements already in the document, so the
					// disposer cannot be a const referenced from inside the handler.
					let dispose: (() => void) | null = null
					let settled = false

					dispose = hookWatch(
						selector,
						(element) => {
							if (settled) {
								return
							}
							if (test && !test(element)) {
								return
							}

							settled = true
							dispose?.()
							resolve(element)
						},
						{ root },
					)

					if (settled) {
						dispose()
					}
				}),
		)

		finishPromise = Promise.all(promises).then((elements) => {
			if (done) {
				try {
					done(...elements)
				} catch (err) {
					console.error("[btr] watch callback failed", err)
				}
			}

			return elements[0]
		})
	}

	return makeWatcher(Promise.resolve(target), finishPromise, null)
}

export const watchAll = (
	target: any,
	selector: string,
	callback: (element: Element) => void,
	props: WatchProps = {},
): Watcher => watch(target, selector.trim(), null, callback, { ...props, continuous: true })

export const onRemove = (target: Node, callback: () => void) => {
	if (!document.contains(target)) {
		return callback()
	}

	const listener = onDomChanged(() => {
		if (!document.contains(target)) {
			listener.disconnect()
			callback()
		}
	})

	return listener
}
