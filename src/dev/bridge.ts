import { SERIALIZE_SRC, serialize } from "@/dev/serialize"

const BRIDGE = "http://127.0.0.1:8787"
const TAB_MATCHES = ["*://www.roblox.com/*", "*://web.roblox.com/*", "*://create.roblox.com/*"]

type Result = { ok: boolean; value?: unknown; error?: string; tab?: { id?: number; url?: string } }
type Job = { id: number; target: string; code: string; idle?: boolean }

const post = (path: string, data: unknown) =>
	fetch(BRIDGE + path, {
		method: "POST",
		body: typeof data === "string" ? data : JSON.stringify(data),
	})

// Expression bodies get their value returned, statement bodies must return themselves.
const bodyOf = (code: string): string => {
	try {
		new Function(`return (${code})`)
		return `return (${code})`
	} catch (err) {
		return code
	}
}

// Firefox MV2 exposes chrome.* as callback based, so do not await it directly.
const call = <T>(fn: (...args: any[]) => void, ...args: any[]): Promise<T> =>
	new Promise((resolve) => fn(...args, resolve))

const findTab = async (): Promise<chrome.tabs.Tab | null> => {
	const query = chrome.tabs.query.bind(chrome.tabs)

	const active = await call<chrome.tabs.Tab[]>(query, { url: TAB_MATCHES, active: true })
	if (active?.length) {
		return active[0]
	}

	const any = await call<chrome.tabs.Tab[]>(query, { url: TAB_MATCHES })
	return any?.length ? any[0] : null
}

const runInTab = async (code: string): Promise<Result> => {
	const tab = await findTab()
	if (!tab?.id) {
		return { ok: false, error: "no roblox tab open" }
	}

	const wrapped = `(async () => {
		const __ser = ${SERIALIZE_SRC}
		try {
			const value = await (async () => { ${bodyOf(code)} })()
			return JSON.stringify({ ok: true, value: __ser(value) })
		} catch(err) {
			return JSON.stringify({ ok: false, error: String(err && err.stack || err) })
		}
	})()`

	const tabs = chrome.tabs as typeof chrome.tabs & {
		executeScript?: (id: number, details: { code: string }, cb?: any) => void
	}

	if (!tabs.executeScript) {
		return { ok: false, error: "tabs.executeScript unavailable (mv3?)" }
	}

	try {
		const results = await call<(string | undefined)[]>(tabs.executeScript!.bind(chrome.tabs), tab.id, {
			code: wrapped,
		})
		const raw = results?.[0]

		if (typeof raw !== "string") {
			return { ok: false, error: "no result from tab" }
		}

		const result = JSON.parse(raw) as Result
		result.tab = { id: tab.id, url: tab.url }
		return result
	} catch (err) {
		return { ok: false, error: String(err) }
	}
}

const runInBackground = async (code: string): Promise<Result> => {
	try {
		const value = await new Function(`return (async () => { ${bodyOf(code)} })()`)()
		return { ok: true, value: serialize(value) }
	} catch (err) {
		return { ok: false, error: String(err instanceof Error ? err.stack : err) }
	}
}

const poll = async (): Promise<void> => {
	for (;;) {
		try {
			const job = (await (await fetch(`${BRIDGE}/poll`)).json()) as Job
			if (job.idle) {
				continue
			}

			const result = job.target === "bg" ? await runInBackground(job.code) : await runInTab(job.code)

			await post("/result", { id: job.id, ...result })
		} catch (err) {
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	}
}

export const startDevBridge = (): void => {
	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.btrDevLog) {
			post("/log", msg.btrDevLog)
		}
	})

	void poll()
}
