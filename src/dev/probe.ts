const describe = (value: unknown): string => {
	if (value instanceof Error) {
		return String(value.stack || value)
	}

	if (value !== null && typeof value === "object") {
		try {
			return JSON.stringify(value)
		} catch (err) {
			return String(value)
		}
	}

	return String(value)
}

const send = (level: string, parts: string[]): void => {
	try {
		chrome.runtime.sendMessage({ btrDevLog: { level, url: location.href, parts } })
	} catch (err) {
		/* background not ready */
	}
}

export const startDevProbe = (): void => {
	for (const level of ["error", "warn"] as const) {
		const original = console[level]

		console[level] = function (...args: unknown[]) {
			send(level, args.map(describe))
			return original.apply(this, args)
		}
	}

	addEventListener("error", (event) => send("error", [describe(event.error ?? event.message)]))
	addEventListener("unhandledrejection", (event) => send("error", [describe(event.reason)]))
}
