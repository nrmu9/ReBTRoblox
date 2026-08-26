"use strict"

// Dev only. Relays content script errors to the background bridge.

if(IS_DEV_MODE) {
	const describe = value => {
		if(value instanceof Error) { return String(value.stack || value) }

		if(value !== null && typeof value === "object") {
			try { return JSON.stringify(value) }
			catch(err) { return String(value) }
		}

		return String(value)
	}

	const send = (level, parts) => {
		try { chrome.runtime.sendMessage({ btrDevLog: { level, url: location.href, parts } }) }
		catch(err) { /* background not ready */ }
	}

	for(const level of ["error", "warn"]) {
		const original = console[level]

		console[level] = function(...args) {
			send(level, args.map(describe))
			return original.apply(this, args)
		}
	}

	addEventListener("error", event => send("error", [describe(event.error || event.message)]))
	addEventListener("unhandledrejection", event => send("error", [describe(event.reason)]))
}
