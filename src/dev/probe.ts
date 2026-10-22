const describe = (value: unknown): string => {
	if (value instanceof Error) {
		return String(value.stack || value)
	}

	// DOMExceptions, and errors from the page's side, are not this world's
	// Error, and JSON makes them {}.
	const error = value as { name?: unknown; message?: unknown; stack?: unknown } | null

	if (error && typeof error === "object" && ("message" in error || "name" in error)) {
		return [`${String(error.name ?? "Error")}: ${String(error.message ?? "")}`, error.stack]
			.filter(Boolean)
			.join("\n")
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
