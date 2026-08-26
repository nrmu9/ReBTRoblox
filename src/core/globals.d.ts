import type { Watcher, WatchProps } from "@/core/watch"

declare global {
	// Page world: provided by Roblox itself or by inject.js, and reached from
	// stringified closures passed to injectScript.call. $ there is Roblox's
	// jQuery, not BTRoblox's.
	const Roblox: any
	const util: any
	const cloneInto: any
	const SHARED_DATA_PAYLOAD: any
	const browser: any
	const $: any

	// Still in legacy js/. Each entry goes away as its module ports.
	const reactHook: any
	const angularHook: any
	const React: any
	const angular: any
	const hijackFunction: any
	const hijackXHR: any
	const onSet: any
	const settings: any
	const HoverPreview: any
	const insertCSS: any
	const removeCSS: any
	const robloxExperiments: any
	const ItemPreviewer: any

	interface Window {
		Roblox?: any
		jQuery?: any
		angular?: any
	}

	// The $ prototype extensions, implemented in core/extend.ts and installed by
	// each entry point. Declared globally because call sites reach them off DOM
	// objects rather than by import.
	interface Element {
		$find<T extends Element = Element>(selector: string): T | null
		$findAll<T extends Element = Element>(selector: string): NodeListOf<T>
		$watch(selector: string | string[], filter?: any, callback?: any, props?: WatchProps): Watcher
		$watchAll(selector: string, callback: (element: Element) => void, props?: WatchProps): Watcher
	}

	interface Document {
		$find<T extends Element = Element>(selector: string): T | null
		$findAll<T extends Element = Element>(selector: string): NodeListOf<T>
		$watch(selector: string | string[], filter?: any, callback?: any, props?: WatchProps): Watcher
		$watchAll(selector: string, callback: (element: Element) => void, props?: WatchProps): Watcher
	}

	interface DocumentFragment {
		$find<T extends Element = Element>(selector: string): T | null
		$findAll<T extends Element = Element>(selector: string): NodeListOf<T>
	}

	interface EventTarget {
		$on(eventType: string, selector?: any, callback?: any, options?: any): this
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
