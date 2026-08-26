// Shared source text so the same serializer can run here and inside an injected tab.

export const SERIALIZE_SRC = `(() => {
	const seen = new WeakSet()

	return function ser(value, depth) {
		depth = depth || 0

		if(value === null) { return null }
		if(value === undefined) { return "[undefined]" }

		const type = typeof value

		if(type === "string" || type === "number" || type === "boolean") { return value }
		if(type === "function") { return "[Function " + (value.name || "anonymous") + "]" }
		if(type === "symbol" || type === "bigint") { return String(value) }

		if(value instanceof Error) {
			return { __type: "Error", message: value.message, stack: value.stack }
		}

		if(typeof Node !== "undefined" && value instanceof Node) {
			const html = value.outerHTML || value.textContent || ""
			return {
				__type: value.nodeName,
				html: html.length > 2000 ? html.slice(0, 2000) + "[+" + (html.length - 2000) + " chars]" : html
			}
		}

		if(depth > 4) { return "[depth limit]" }
		if(seen.has(value)) { return "[circular]" }
		seen.add(value)

		if(type === "object" && typeof value[Symbol.iterator] === "function") {
			const list = Array.from(value)
			const out = list.slice(0, 100).map(item => ser(item, depth + 1))
			if(list.length > 100) { out.push("[+" + (list.length - 100) + " more]") }
			return out
		}

		const out = {}

		for(const key of Object.keys(value).slice(0, 100)) {
			try { out[key] = ser(value[key], depth + 1) }
			catch(err) { out[key] = "[throws: " + err.message + "]" }
		}

		return out
	}
})()`

export const serialize = (0, eval)(SERIALIZE_SRC) as (value: unknown) => unknown
