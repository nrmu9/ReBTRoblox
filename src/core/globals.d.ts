import type { Watcher, WatchProps } from "@/core/watch"

declare global {
	/** Folded to a literal at build time so dev-only code can be tree shaken out. */
	const __DEV__: boolean
	/** Build time twin of IS_MANIFEST_V3, so target-only code can be dropped. */
	const __MV3__: boolean

	// Page world: provided by Roblox itself. $ is Roblox's jQuery, not
	// ReBTRoblox's.
	const Roblox: any
	const SHARED_DATA_PAYLOAD: any
	const $: any
	const React: any
	const angular: any

	interface Window {
		next?: any
		explorer?: any
		preview?: any
		ReBTRoblox?: any
		scene?: any
		Roblox?: any
		jQuery?: any
		angular?: any
	}

	// The $ prototype extensions, implemented in core/extend.ts and installed by
	// each entry point. Declared globally because call sites reach them off DOM
	// objects rather than by import.
	interface Element {
		$find<T extends Element = HTMLElement>(selector: string): T | null
		$req<T extends Element = HTMLElement>(selector: string): T
		$findAll<T extends Element = HTMLElement>(selector: string): NodeListOf<T>
		$watch(selector: string | string[], filter?: any, callback?: any, props?: WatchProps): Watcher
		$watchAll<T extends Element = HTMLElement>(
			selector: string,
			callback: (element: T, stop: () => void) => void,
			props?: WatchProps,
		): Watcher
	}

	interface Document {
		$find<T extends Element = HTMLElement>(selector: string): T | null
		$req<T extends Element = HTMLElement>(selector: string): T
		$findAll<T extends Element = HTMLElement>(selector: string): NodeListOf<T>
		$watch(selector: string | string[], filter?: any, callback?: any, props?: WatchProps): Watcher
		$watchAll<T extends Element = HTMLElement>(
			selector: string,
			callback: (element: T, stop: () => void) => void,
			props?: WatchProps,
		): Watcher
	}

	interface DocumentFragment {
		$find<T extends Element = HTMLElement>(selector: string): T | null
		$req<T extends Element = HTMLElement>(selector: string): T
		$findAll<T extends Element = HTMLElement>(selector: string): NodeListOf<T>
	}

	/**
	 * What a $on handler receives. The delegated form redefines currentTarget to
	 * the element the selector matched, so unlike the DOM it is always an
	 * element rather than EventTarget | null.
	 */
	type BtrEvent<E extends Event = Event> = E & { readonly currentTarget: HTMLElement }

	interface EventTarget {
		$on<E extends Event = Event>(
			eventType: string,
			callback: (ev: BtrEvent<E>) => void,
			options?: AddEventListenerOptions,
		): this
		$on<E extends Event = Event>(
			eventType: string,
			selector: string,
			callback: (ev: BtrEvent<E>) => void,
			options?: AddEventListenerOptions,
		): this
		$off(eventType: string, selector?: any, callback?: any, options?: any): this
	}

	interface Node {
		$onRemove(callback: () => void): any
	}

	interface Date {
		$format(format: string): string
		$since(relativeTo?: any, short?: boolean): string
	}
}
