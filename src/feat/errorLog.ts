import { IS_BACKGROUND_PAGE } from "@/core/env"
import { backgroundScript, contentScript, injectScript } from "@/core/messaging"
import { isKey, isText } from "@/core/pageInput"

// The last few things that went wrong in the extension, kept on this device
// for a bug report. Only our own failures count: errors whose stack is in our
// files, and what our code logs as an error. Pages are kept without their
// query, stacks without the extension's id, which is unique to each install,
// and nothing leaves the browser unless it is copied.

export interface ErrorEntry {
	at: number
	/** Which side of the extension: content, page or background. */
	where: string
	message: string
	stack?: string
	/** The page's path, without its query. */
	page?: string
	/** How many times it happened, as repeats are kept as one. */
	count: number
	version: string
}

const KEY = "errorLog"
const LIMIT = 50
// The same error again within this long only adds to its count.
const REPEAT_WINDOW = 10 * 60e3

// Through callbacks: Firefox's chrome namespace under MV2 returns no promises.
const load = () =>
	new Promise<ErrorEntry[]>((resolve) =>
		chrome.storage.local.get(KEY, (data) => resolve(Array.isArray(data?.[KEY]) ? data[KEY] : [])),
	)

const save = (log: ErrorEntry[] | null) =>
	new Promise<void>((resolve) =>
		log
			? chrome.storage.local.set({ [KEY]: log }, () => resolve())
			: chrome.storage.local.remove(KEY, () => resolve()),
	)

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** A stack without the extension's address, which says which install it came from. */
export const cleanStack = (stack: string) =>
	clip(stack.replace(/(?:moz|chrome)-extension:\/\/[^/\s)]+\//g, "ext/"), 1500)

/** Whether a stack runs through our own files. */
const ours = (stack: string | undefined) => !!stack && /(?:moz|chrome)-extension:\/\//.test(stack)

const describe = (value: unknown): { message: string; stack?: string } => {
	if (value instanceof Error) {
		return { message: `${value.name}: ${value.message}`, ...(value.stack ? { stack: value.stack } : {}) }
	}

	if (typeof value === "string") {
		return { message: value }
	}

	try {
		return { message: JSON.stringify(value) ?? String(value) }
	} catch {
		return { message: String(value) }
	}
}

// The background keeps the log, one write at a time.
let writing: Promise<void> = Promise.resolve()

const record = (entry: Omit<ErrorEntry, "count" | "version">) => {
	writing = writing
		.then(async () => {
			const log = await load()
			const same = log.find(
				(other) =>
					other.message === entry.message &&
					other.where === entry.where &&
					entry.at - other.at < REPEAT_WINDOW,
			)

			if (same) {
				same.count++
				same.at = entry.at
			} else {
				log.push({ ...entry, count: 1, version: chrome.runtime.getManifest().version })
			}

			await save(log.slice(-LIMIT))
		})
		// One failed write must not stop every later one.
		.catch(() => {})
}

// Set while an error is being sent, so one that sending causes is not sent too.
let busy = false

/** Sends an error to the log, from whichever side this is. */
export const logError = (where: string, value: unknown) => {
	if (busy) {
		return
	}

	busy = true

	try {
		send(where, value)
	} finally {
		busy = false
	}
}

const send = (where: string, value: unknown) => {
	const { message, stack } = describe(value)

	const entry = {
		at: Date.now(),
		where,
		message: clip(message, 500),
		...(stack ? { stack: cleanStack(stack) } : {}),
		...(typeof location === "object" && !IS_BACKGROUND_PAGE ? { page: location.pathname } : {}),
	}

	if (IS_BACKGROUND_PAGE) {
		record(entry)
	} else {
		backgroundScript.send("errorLog", entry)
	}
}

/** Starts catching errors on this side of the extension. */
export const startErrorLog = (where: "content" | "background") => {
	// What our code logs as an error, passed on as before.
	const original = console.error.bind(console)

	console.error = (...args: unknown[]) => {
		original(...args)

		try {
			const error = args.find((arg) => arg instanceof Error) ?? args.map(String).join(" ")
			logError(where, error)
		} catch {}
	}

	// Uncaught ones, but only ours: the page's own errors reach these too.
	addEventListener("error", (event) => {
		if (ours(event.error?.stack) || /(?:moz|chrome)-extension:\/\//.test(event.filename ?? "")) {
			logError(where, event.error ?? event.message)
		}
	})

	addEventListener("unhandledrejection", (event) => {
		if (ours((event.reason as Error | undefined)?.stack)) {
			logError(where, event.reason)
		}
	})

	// Page side hooks that fail, which only the content script hears about.
	if (where === "content") {
		injectScript.listen("injectError", (name: unknown, stack: unknown) => {
			if (isKey(name) && isText(stack, 2000)) {
				const error = new Error(`${name} failed`)
				error.stack = stack
				logError("page", error)
			}
		})
	}

	if (IS_BACKGROUND_PAGE) {
		contentScript.listen("errorLog", (entry: ErrorEntry) => {
			if (entry && typeof entry.message === "string" && typeof entry.where === "string") {
				record({
					at: Date.now(),
					where: clip(entry.where, 20),
					message: clip(entry.message, 500),
					...(typeof entry.stack === "string" ? { stack: clip(entry.stack, 1500) } : {}),
					...(typeof entry.page === "string" ? { page: clip(entry.page, 200) } : {}),
				})
			}
		})

		contentScript.listen("errorLogClear", () => {
			writing = writing.then(() => save(null))
		})
	}
}

export const readErrorLog = (): Promise<ErrorEntry[]> => load()

export const clearErrorLog = () => backgroundScript.send("errorLogClear")

/** The log as text for a bug report: version, browser, then each error, newest first. */
export const errorReport = (log: ErrorEntry[]) =>
	[
		`ReBTRoblox ${chrome.runtime.getManifest().version} · ${navigator.userAgent}`,
		"",
		...log
			.toReversed()
			.map((entry) =>
				[
					`${new Date(entry.at).toISOString()} [${entry.where}]${entry.page ? ` ${entry.page}` : ""}${entry.count > 1 ? ` ×${entry.count}` : ""}`,
					entry.message,
					entry.stack ?? "",
				]
					.filter(Boolean)
					.join("\n"),
			),
	].join("\n\n")

/** The browser and its major version, as a bug report asks for it. */
export const browserName = (userAgent: string) => {
	for (const [name, pattern] of [
		["Firefox", /Firefox\/(\d+)/],
		["Edge", /Edg\/(\d+)/],
		["Opera", /OPR\/(\d+)/],
		["Chrome", /Chrome\/(\d+)/],
	] as const) {
		const match = userAgent.match(pattern)

		if (match) {
			return `${name} ${match[1]}`
		}
	}

	return ""
}

// Only the version and browser go in the address. The report itself is
// pasted, so nothing about the pages visited ends up in a link.
export const bugReportUrl = (version: string, userAgent: string) =>
	`https://github.com/nrmu9/ReBTRoblox/issues/new?${new URLSearchParams({
		template: "bug_report.yml",
		version,
		browser: browserName(userAgent),
	})}`
