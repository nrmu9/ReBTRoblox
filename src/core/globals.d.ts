// Ambient names that are not ES modules.
//
// Page world: provided by Roblox itself or by inject.js, and reached from
// stringified closures passed to injectScript.call.
declare const Roblox: any
declare const util: any
declare const cloneInto: any
declare const SHARED_DATA_PAYLOAD: any
declare const browser: any

// Still in legacy js/. Each entry goes away as its module ports.
declare const reactHook: any
declare const insertCSS: any
declare const removeCSS: any
declare const formatNumber: any
declare const loggedInUser: any
declare const loggedInUserPromise: any
declare const robloxExperiments: any

// The $ DOM-extension layer, still implemented in js/utility.js. These prototype
// extensions have ~500 call sites across feat/ and pages/, so they are declared
// here until that layer ports onto core/hook.ts.
interface BtrWatcher {
	$watch(selector: string, callback?: (...nodes: any[]) => void, props?: any): BtrWatcher
	$watchAll(selector: string, callback?: (node: any) => void, props?: any): BtrWatcher
	$then(): BtrWatcher
	$promise(): Promise<any>
	$resolve(value?: any): any
	$digest(): void
}

interface Element extends BtrWatcher {
	$find(selector: string): any
	$findAll(selector: string): any[]
	$on(events: string, selectorOrHandler?: any, handler?: any): Element
	$off(events: string, handler?: any): Element
}

interface Document extends BtrWatcher {
	$find(selector: string): any
	$findAll(selector: string): any[]
	$on(events: string, selectorOrHandler?: any, handler?: any): Document
	$off(events: string, handler?: any): Document
}

interface Date {
	$format(format?: string): string
	$since(relativeTo?: any, short?: boolean): string
}

// Page world only: Roblox's own jQuery, reached from stringified injectScript
// closures. Not BTRoblox's $.
declare const $: any

interface Window {
	Roblox?: any
	jQuery?: any
	angular?: any
}
