// Dynamic element hooking.
//
// Roblox renders with React, so nodes appear long after page load. Detection uses
// two paths that share one dedupe set:
//
//   1. CSS animation events. A rule per selector starts a zero-duration animation
//      when a matching node is inserted, so the CSS engine does the matching and
//      delivery is immediate. Costs nothing while idle.
//   2. A microtask-batched MutationObserver re-querying each registration.
//      Covers what path 1 cannot see: nodes inserted while display:none, since
//      animations do not run on them, and selectors scoped to a root element,
//      which a global stylesheet cannot express. Batching is a microtask rather
//      than a frame so detection keeps working in background tabs, where
//      requestAnimationFrame never fires.

import { scopeSelector } from "@/core/query"

type Handler = (element: Element) => void

export interface WatchOptions {
	signal?: AbortSignal
	once?: boolean
	root?: Element | Document
	existing?: boolean
}

interface Registration {
	selector: string
	handler: Handler
	once: boolean
	root: Element | Document
	seen: WeakSet<Element>
	animation: string
	styled: boolean
	disposed: boolean
}

const ANIMATION_PREFIX = "btr-hook-"

const registrations = new Map<string, Registration>()

let sheet: CSSStyleSheet | null = null
let observer: MutationObserver | null = null
let pending = false
let nextId = 0

const contains = (root: Element | Document, element: Element): boolean =>
	root === document || root === element || (root as Element).contains(element)

const deliver = (registration: Registration, element: Element): void => {
	if (registration.disposed || registration.seen.has(element)) {
		return
	}

	// The stylesheet is global, so an animation event can arrive for a node
	// outside a root-scoped watcher.
	if (!contains(registration.root, element)) {
		return
	}

	registration.seen.add(element)

	if (registration.once) {
		dispose(registration)
	}

	try {
		registration.handler(element)
	} catch (err) {
		console.error(`[btr] hook handler failed for "${registration.selector}"`, err)
	}
}

const sweep = (registration: Registration): void => {
	let found: NodeListOf<Element>

	try {
		found = registration.root.querySelectorAll(registration.selector)
	} catch (err) {
		console.error(`[btr] invalid selector "${registration.selector}"`, err)
		dispose(registration)
		return
	}

	for (const element of found) {
		deliver(registration, element)
		if (registration.disposed) {
			return
		}
	}
}

const flush = (): void => {
	pending = false

	for (const registration of [...registrations.values()]) {
		if (!registration.disposed) {
			sweep(registration)
		}
	}
}

const onAnimationStart = (event: AnimationEvent): void => {
	if (!event.animationName.startsWith(ANIMATION_PREFIX)) {
		return
	}

	const registration = registrations.get(event.animationName)

	if (registration && event.target instanceof Element) {
		deliver(registration, event.target)
	}
}

const ensureSheet = (): CSSStyleSheet => {
	if (sheet) {
		return sheet
	}

	const style = document.createElement("style")
	style.dataset.btrHook = ""
	;(document.head ?? document.documentElement).append(style)

	sheet = style.sheet as CSSStyleSheet

	document.addEventListener("animationstart", onAnimationStart, true)

	observer = new MutationObserver(() => {
		if (pending) {
			return
		}

		pending = true
		queueMicrotask(flush)
	})

	observer.observe(document.documentElement, { childList: true, subtree: true })

	return sheet
}

const dispose = (registration: Registration): void => {
	if (registration.disposed) {
		return
	}

	registration.disposed = true
	registrations.delete(registration.animation)

	if (!sheet || !registration.styled) {
		return
	}

	for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
		if (sheet.cssRules[index].cssText.includes(registration.animation)) {
			sheet.deleteRule(index)
		}
	}
}

/** Calls handler for every element matching selector, now and as they appear. */
export const watch = (selector: string, handler: Handler, options: WatchOptions = {}): (() => void) => {
	const registration: Registration = {
		selector: scopeSelector(selector),
		handler,
		once: options.once ?? false,
		root: options.root ?? document,
		seen: new WeakSet(),
		animation: `${ANIMATION_PREFIX}${nextId++}`,
		styled: false,
		disposed: false,
	}

	registrations.set(registration.animation, registration)

	const target = ensureSheet()

	// A stylesheet cannot express :scope, so root-relative selectors rely on the
	// observer path alone.
	if (!registration.selector.includes(":scope")) {
		try {
			target.insertRule(
				`@keyframes ${registration.animation}{from{outline-color:rgba(0,0,0,0)}to{outline-color:rgba(0,0,0,0)}}`,
				target.cssRules.length,
			)

			target.insertRule(
				`${registration.selector}{animation-duration:.0001s;animation-name:${registration.animation}}`,
				target.cssRules.length,
			)

			registration.styled = true
		} catch (err) {
			console.error(`[btr] could not install rule for "${registration.selector}"`, err)
		}
	}

	if (options.existing ?? true) {
		sweep(registration)
	}

	options.signal?.addEventListener("abort", () => dispose(registration), { once: true })

	return () => dispose(registration)
}

/** Resolves with the first element matching selector. */
export const waitFor = (
	selector: string,
	options: WatchOptions & { timeout?: number } = {},
): Promise<Element> =>
	new Promise((resolve, reject) => {
		// Delivery is synchronous for elements already present, so neither the
		// disposer nor the timer can be a const referenced from the handler.
		let dispose: (() => void) | null = null
		let timer: ReturnType<typeof setTimeout> | undefined
		let settled = false

		const finish = (): void => {
			settled = true
			dispose?.()
			clearTimeout(timer)
		}

		dispose = watch(
			selector,
			(element) => {
				if (settled) {
					return
				}

				finish()
				resolve(element)
			},
			{ ...options, once: true },
		)

		if (settled) {
			dispose()
			return
		}

		if (options.timeout) {
			timer = setTimeout(() => {
				finish()
				reject(new Error(`timed out waiting for "${selector}"`))
			}, options.timeout)
		}

		options.signal?.addEventListener(
			"abort",
			() => {
				finish()
				reject(new Error("aborted"))
			},
			{ once: true },
		)
	})
