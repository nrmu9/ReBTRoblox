/** Narrows the checked value, so callers do not need a second guard. */
export function assert(value: unknown, ...args: unknown[]): asserts value {
	if (!value) {
		throw new Error(args.map(String).join(" "))
	}
}

export const assertWarn = <T>(value: T, ...args: unknown[]): T => {
	if (!value) {
		console.warn(...args)
	}
	return value
}

export const hashString = (str: string): string => {
	let hash = 0

	for (let index = 0, len = str.length; index < len; index++) {
		hash = ((hash << 5) - hash + str.charCodeAt(index)) | 0
	}

	return (hash >>> 0).toString(16).toUpperCase()
}

export const stringToBuffer = (str: string): ArrayBuffer => {
	const buffer = new ArrayBuffer(str.length)
	const view = new Uint8Array(buffer)

	for (let index = str.length; index--;) {
		view[index] = str.charCodeAt(index)
	}

	return buffer
}

export const bufferToString = (source: ArrayBuffer | Uint8Array): string => {
	const view = source instanceof ArrayBuffer ? new Uint8Array(source) : source
	const parts: string[] = []

	for (let index = 0; index < view.length; index += 0x8000) {
		parts.push(String.fromCharCode(...view.subarray(index, index + 0x8000)))
	}

	return parts.join("")
}

export const ready = (fn: () => void): void => {
	if (document.readyState !== "loading") {
		fn()
	} else {
		document.addEventListener("DOMContentLoaded", fn, { once: true })
	}
}

/**
 * Turns an item name into something safe to write to disk: accents folded to
 * plain letters, emoji and control codes dropped, whitespace collapsed, and the
 * characters Windows refuses in a filename removed. Returns the fallback when
 * nothing printable survives, which is what happens for all emoji names.
 */
export const formatFileName = (name: string, fallback: string): string => {
	const cleaned = name
		.normalize("NFKD")
		// accents left as combining marks by the decomposition above, plus the
		// variation and keycap marks that trail emoji
		.replace(/\p{M}/gu, "")
		.replace(/\p{Extended_Pictographic}/gu, "")
		// control and format codepoints
		.replace(/\p{C}/gu, "")
		// reserved in filenames on Windows
		.replace(/[<>:"/\\|?*]/g, "")
		// underscores rather than spaces, so the name survives a shell unquoted
		.replace(/\s+/g, "_")
		// a leading or trailing dot makes for a hidden or malformed file
		.replace(/^[_.\s]+|[_.\s]+$/g, "")

	// Reserved device names still resolve even with an extension appended.
	if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) {
		return fallback
	}

	return cleaned.slice(0, 100)
}

/** Runs fn at most once, returning the cached result thereafter. */
export const onceFn = <T extends (...args: any[]) => any>(fn: T): T => {
	let called = false
	let result: any

	return function (this: any, ...args: any[]) {
		if (!called) {
			called = true
			result = fn.apply(this, args)
		}

		return result
	} as T
}
