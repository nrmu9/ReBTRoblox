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
	/**
	 * The React internals shim defined in inject.ts and reached from page world
	 * closures.
	 *
	 * The element and props shapes stay `any`: they are React's internals, not
	 * ours, and pinning them down would be inventing guarantees React does not
	 * give. What is worth typing is the callback shapes, so the 180 odd call
	 * sites get their parameters inferred instead of silently widening to any.
	 */
	interface ReactElementLike {
		props: any
		type?: any
		key?: any
		[key: string]: any
	}

	/**
	 * The jQuery-ish wrapper reactHook.inject hands to its callbacks: indexable
	 * like an element list, but with its own DOM-shaped helpers that operate on
	 * React props rather than on real nodes.
	 */
	interface ReactWrappedClassList {
		add(...tokens: string[]): void
		remove(...tokens: string[]): void
		contains(token: string): boolean
		toggle(token: string, force?: boolean): void
	}

	interface ReactWrapped {
		readonly btrIsWrapped: true
		readonly path: any[]
		readonly classList: ReactWrappedClassList
		[index: number]: ReactElementLike

		matches(selector: any): boolean
		find(selector: any): ReactWrapped | null
		parent(): ReactWrapped | null
		prepend(elem: any): void
		append(elem: any): void
		before(...elems: any[]): void
		after(...elems: any[]): void
		replaceWith(...elems: any[]): void
		remove(): void

		[key: string]: any
	}

	interface ReactConstructorHook {
		index: number
		filter: (props: any) => boolean
		handler: (target: any, thisArg: any, args: any[]) => any
		removed?: boolean
		remove(): void
	}

	interface ReactHook {
		renderTarget: any
		React: any
		constructorReplaces: ReactConstructorHook[]

		inject(selector: string, callback: (elem: ReactWrapped) => void): void

		hijackConstructor(
			filter: (props: any) => boolean,
			handler: (target: any, thisArg: any, args: any[]) => any
		): ReactConstructorHook

		hijackUseState(
			filter: (value: any, index: number) => boolean,
			transform: (value: any, initial: any) => any,
			permanent?: boolean
		): void

		hijackUseStateGlobal(
			filter: (value: any, index: number) => boolean,
			transform: (value: any, initial: any) => any
		): void

		queryElement(targets: any, queries: any, depth?: number, mustMatchRoot?: boolean, all?: boolean): any
		querySelector(element: any, selectors: any, depth?: number, path?: boolean): any
		querySelectorAll(element: any, selectors: any, depth?: number, path?: boolean): any
		selectorMatches(elem: any, selectors: any): boolean
		parseReactStringSelector(selector: string): any[]
		parseReactSelector(selectors: any): any

		createElement(...args: any[]): any
		createGlobalState(value: any): any
		useGlobalState(globalState: any): any
		unwrap(elem: any): any
		wrap(path: any): any

		onCreateElement(target: any, thisArg: any, args: any[]): any
		nextConstructorReplace(render: any, index: number, thisArg?: any, args?: any): any
		onReact(react: any): void
		applyProxy(...args: any[]): any
		init(): void

		[key: string]: any
	}

	const reactHook: ReactHook
	const angularHook: any
	const React: any
	const angular: any
	const hijackFunction: any
	const hijackXHR: any
	const onSet: any
	const settings: any
	const BTRoblox: any
	const Mui: any
	const HoverPreview: any
	const insertCSS: any
	const removeCSS: any
	const robloxExperiments: any
	const ItemPreviewer: any
	const Explorer: any
	const RBXScene: any
	const RBXAvatar: any

	interface Window {
		next?: any
		explorer?: any
		preview?: any
		BTRoblox?: any
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
		$watchAll(selector: string, callback: (element: Element, stop: () => void) => void, props?: WatchProps): Watcher
	}

	interface Document {
		$find<T extends Element = HTMLElement>(selector: string): T | null
		$req<T extends Element = HTMLElement>(selector: string): T
		$findAll<T extends Element = HTMLElement>(selector: string): NodeListOf<T>
		$watch(selector: string | string[], filter?: any, callback?: any, props?: WatchProps): Watcher
		$watchAll(selector: string, callback: (element: Element, stop: () => void) => void, props?: WatchProps): Watcher
	}

	interface DocumentFragment {
		$find<T extends Element = HTMLElement>(selector: string): T | null
		$req<T extends Element = HTMLElement>(selector: string): T
		$findAll<T extends Element = HTMLElement>(selector: string): NodeListOf<T>
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
