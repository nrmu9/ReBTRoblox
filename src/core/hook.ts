// Dynamic element hooking.
//
// Roblox renders with React, so nodes appear long after page load. Detection uses
// two paths that share one dedupe set:
//
//   1. CSS animation events. A rule per selector starts a zero-duration animation
//      when a matching node is inserted, so the CSS engine does the matching and
//      delivery is immediate. Costs nothing while idle.
//   2. A single microtask-batched MutationObserver running one combined
//      querySelectorAll. Covers what path 1 cannot see: nodes inserted while
//      display:none, since animations do not run on them. Batching is a microtask
//      rather than a frame so detection keeps working in background tabs, where
//      requestAnimationFrame never fires.

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
	disposed: boolean
}

const ANIMATION_PREFIX = "btr-hook-"

const registrations = new Map<string, Registration>()

let sheet: CSSStyleSheet | null = null
let observer: MutationObserver | null = null
let combined = ""
let pending = false
let nextId = 0

const rebuildCombined = (): void => {
	const parts: string[] = []

	for(const registration of registrations.values()) {
		if(!registration.disposed) { parts.push(registration.selector) }
	}

	combined = parts.join(",")
}

const deliver = (registration: Registration, element: Element): void => {
	if(registration.disposed || registration.seen.has(element)) { return }

	registration.seen.add(element)

	if(registration.once) { dispose(registration) }

	try {
		registration.handler(element)
	} catch(err) {
		console.error(`[btr] hook handler failed for "${registration.selector}"`, err)
	}
}

const sweep = (registration: Registration): void => {
	for(const element of registration.root.querySelectorAll(registration.selector)) {
		deliver(registration, element)
		if(registration.disposed) { return }
	}
}

const flush = (): void => {
	pending = false

	if(!combined) { return }

	for(const element of document.querySelectorAll(combined)) {
		for(const registration of registrations.values()) {
			if(registration.disposed || registration.seen.has(element)) { continue }
			if(element.matches(registration.selector)) { deliver(registration, element) }
		}
	}
}

const onAnimationStart = (event: AnimationEvent): void => {
	if(!event.animationName.startsWith(ANIMATION_PREFIX)) { return }

	const registration = registrations.get(event.animationName)

	if(registration && event.target instanceof Element) {
		deliver(registration, event.target)
	}
}

const ensureSheet = (): CSSStyleSheet => {
	if(sheet) { return sheet }

	const style = document.createElement("style")
	style.dataset.btrHook = ""
	;(document.head ?? document.documentElement).append(style)

	sheet = style.sheet as CSSStyleSheet

	document.addEventListener("animationstart", onAnimationStart, true)

	observer = new MutationObserver(() => {
		if(pending) { return }

		pending = true
		queueMicrotask(flush)
	})

	observer.observe(document.documentElement, { childList: true, subtree: true })

	return sheet
}

const dispose = (registration: Registration): void => {
	if(registration.disposed) { return }

	registration.disposed = true
	registrations.delete(registration.animation)
	rebuildCombined()

	if(!sheet) { return }

	for(let index = sheet.cssRules.length - 1; index >= 0; index--) {
		const rule = sheet.cssRules[index]
		const text = rule.cssText

		if(text.includes(registration.animation)) { sheet.deleteRule(index) }
	}
}

/** Calls handler for every element matching selector, now and as they appear. */
export const watch = (selector: string, handler: Handler, options: WatchOptions = {}): (() => void) => {
	const registration: Registration = {
		selector,
		handler,
		once: options.once ?? false,
		root: options.root ?? document,
		seen: new WeakSet(),
		animation: `${ANIMATION_PREFIX}${nextId++}`,
		disposed: false
	}

	registrations.set(registration.animation, registration)
	rebuildCombined()

	const target = ensureSheet()

	target.insertRule(
		`@keyframes ${registration.animation}{from{outline-color:rgba(0,0,0,0)}to{outline-color:rgba(0,0,0,0)}}`,
		target.cssRules.length
	)

	target.insertRule(
		`${selector}{animation-duration:.0001s;animation-name:${registration.animation}}`,
		target.cssRules.length
	)

	if(options.existing ?? true) { sweep(registration) }

	options.signal?.addEventListener("abort", () => dispose(registration), { once: true })

	return () => dispose(registration)
}

/** Resolves with the first element matching selector. */
export const waitFor = (selector: string, options: WatchOptions & { timeout?: number } = {}): Promise<Element> =>
	new Promise((resolve, reject) => {
		const controller = new AbortController()

		const stop = watch(selector, element => {
			controller.abort()
			clearTimeout(timer)
			resolve(element)
		}, { ...options, once: true })

		const timer = options.timeout
			? setTimeout(() => {
				stop()
				reject(new Error(`timed out waiting for "${selector}"`))
			}, options.timeout)
			: undefined

		options.signal?.addEventListener("abort", () => {
			stop()
			clearTimeout(timer)
			reject(new Error("aborted"))
		}, { once: true })
	})
