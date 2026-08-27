/** Narrows the checked value, so callers do not need a second guard. */
export function assert(value: unknown, ...args: unknown[]): asserts value {
	if(!value) { throw new Error(args.map(String).join(" ")) }
}

export const assertWarn = <T>(value: T, ...args: unknown[]): T => {
	if(!value) { console.warn(...args) }
	return value
}

export const hashString = (str: string): string => {
	let hash = 0

	for(let index = 0, len = str.length; index < len; index++) {
		hash = (((hash << 5) - hash) + str.charCodeAt(index)) | 0
	}

	return (hash >>> 0).toString(16).toUpperCase()
}

export const stringToBuffer = (str: string): ArrayBuffer => {
	const buffer = new ArrayBuffer(str.length)
	const view = new Uint8Array(buffer)

	for(let index = str.length; index--;) {
		view[index] = str.charCodeAt(index)
	}

	return buffer
}

export const bufferToString = (source: ArrayBuffer | Uint8Array): string => {
	const view = source instanceof ArrayBuffer ? new Uint8Array(source) : source
	const parts: string[] = []

	for(let index = 0; index < view.length; index += 0x8000) {
		parts.push(String.fromCharCode(...view.subarray(index, index + 0x8000)))
	}

	return parts.join("")
}

export const ready = (fn: () => void): void => {
	if(document.readyState !== "loading") {
		fn()
	} else {
		document.addEventListener("DOMContentLoaded", fn, { once: true })
	}
}

/** Runs fn at most once, returning the cached result thereafter. */
export const onceFn = <T extends (...args: any[]) => any>(fn: T): T => {
	let called = false
	let result: any

	return function(this: any, ...args: any[]) {
		if(!called) {
			called = true
			result = fn.apply(this, args)
		}

		return result
	} as T
}
