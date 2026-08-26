"use strict"

// Dev only. Runs code sent by dev/bridge.py inside the extension.

if(IS_DEV_MODE && IS_BACKGROUND_PAGE) {
	const BRIDGE = "http://127.0.0.1:8787"
	const TAB_MATCHES = ["*://www.roblox.com/*", "*://web.roblox.com/*", "*://create.roblox.com/*"]

	const SERIALIZE = `(() => {
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

	const serialize = eval(SERIALIZE)
	const call = (fn, ...args) => new Promise(resolve => fn(...args, resolve))

	const post = (path, data) => fetch(BRIDGE + path, {
		method: "POST",
		body: typeof data === "string" ? data : JSON.stringify(data)
	})

	// Expression bodies get their value returned, statement bodies must return themselves.
	const isExpression = code => {
		try { new Function(`return (${code})`); return true }
		catch(err) { return false }
	}

	const bodyOf = code => isExpression(code) ? `return (${code})` : code

	const findTab = async () => {
		const active = await call(chrome.tabs.query.bind(chrome.tabs), { url: TAB_MATCHES, active: true })
		if(active && active.length) { return active[0] }

		const any = await call(chrome.tabs.query.bind(chrome.tabs), { url: TAB_MATCHES })
		return any && any.length ? any[0] : null
	}

	const runInTab = async code => {
		const tab = await findTab()
		if(!tab) { return { ok: false, error: "no roblox tab open" } }

		const wrapped = `(async () => {
			const __ser = ${SERIALIZE}
			try {
				const value = await (async () => { ${bodyOf(code)} })()
				return JSON.stringify({ ok: true, value: __ser(value) })
			} catch(err) {
				return JSON.stringify({ ok: false, error: String(err && err.stack || err) })
			}
		})()`

		const results = await call(chrome.tabs.executeScript.bind(chrome.tabs), tab.id, { code: wrapped })

		if(chrome.runtime.lastError) {
			return { ok: false, error: chrome.runtime.lastError.message }
		}

		const result = JSON.parse(results[0])
		result.tab = { id: tab.id, url: tab.url }
		return result
	}

	const runInBackground = async code => {
		try {
			const value = await new Function(`return (async () => { ${bodyOf(code)} })()`)()
			return { ok: true, value: serialize(value) }
		} catch(err) {
			return { ok: false, error: String(err && err.stack || err) }
		}
	}

	const poll = async () => {
		for(;;) {
			try {
				const job = await (await fetch(BRIDGE + "/poll")).json()
				if(job.idle) { continue }

				const result = job.target === "bg"
					? await runInBackground(job.code)
					: await runInTab(job.code)

				await post("/result", { id: job.id, ...result })
			} catch(err) {
				await new Promise(resolve => setTimeout(resolve, 1000))
			}
		}
	}

	chrome.runtime.onMessage.addListener(msg => {
		if(msg && msg.btrDevLog) { post("/log", msg.btrDevLog) }
	})

	poll()
}
