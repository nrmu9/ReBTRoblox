// Installs the $ prototype extensions.
//
// The names are kept because roughly 500 call sites across feat/ and pages/ use
// them, but every one now routes into a typed module rather than js/utility.js.
// Import this once per entry point, before any module that uses them.

import { dateFormat, dateSince } from "@/core/date"
import { find, findAll } from "@/core/query"
import { off, on } from "@/core/events"
import { onRemove, watch, watchAll } from "@/core/watch"

const define = (targets: any[], props: Record<string, unknown>): void => {
	for(const target of targets) {
		if(!target?.prototype) { continue }

		for(const [name, value] of Object.entries(props)) {
			Object.defineProperty(target.prototype, name, {
				value,
				writable: true,
				configurable: true,
				enumerable: false
			})
		}
	}
}

export const installExtensions = (): void => {
	// A MV3 service worker has no DOM constructors to extend.
	if(typeof Element === "undefined") { return }

	define([EventTarget], {
		$on(this: EventTarget, ...args: any[]) { return (on as any)(this, ...args) },
		$off(this: EventTarget, ...args: any[]) { return (off as any)(this, ...args) }
	})

	define([Element, Document, DocumentFragment], {
		$find(this: ParentNode, selector: string) { return find(this, selector) },
		$findAll(this: ParentNode, selector: string) { return findAll(this, selector) },
		$watch(this: ParentNode, ...args: any[]) { return (watch as any)(this, ...args) },
		$watchAll(this: ParentNode, ...args: any[]) { return (watchAll as any)(this, ...args) }
	})

	define([Node], {
		$onRemove(this: Node, callback: () => void) { return onRemove(this, callback) }
	})

	define([Date], {
		$format(this: Date, format: string) { return dateFormat(this, format) },
		$since(this: Date, relativeTo?: any, short?: boolean) { return dateSince(this, relativeTo, short) }
	})
}
