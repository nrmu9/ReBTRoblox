import { SETTINGS } from "@/feat/settings"

// Settings follow the browser's own sync, so they come back after a reinstall
// and match on every computer signed in to it. Only the background writes, the
// newest save wins, and activity stays on this device: sync holds about 100 KB.

const LOCAL_KEY = "btrSettings"
const HEADER = "btrSync"
const CHUNK = "btrSync:"
// Each item may hold 8 KB with its key, and all of sync about 100 KB.
const CHUNK_CHARS = 7000
const MAX_CHARS = 90_000
const PUSH_DELAY = 3000
// Kept per device: turning sync off on one computer should not turn it off on all of them.
const OWN = "general.syncSettings"

interface Header {
	format: number
	savedAt: number
	chunks: number
}

interface LocalPayload {
	format: number
	values: Record<string, unknown>
	savedAt?: number
}

const area = () => (chrome.storage as typeof chrome.storage | undefined)?.sync ?? null

/** A storage call as a promise, null when it failed or sync is not there. */
const call = <T>(run: (done: (value: T) => void) => void) =>
	new Promise<T | null>((resolve) => {
		try {
			run((value) => resolve(chrome.runtime.lastError ? null : value))
		} catch {
			resolve(null)
		}
	})

/** A storage write as a promise of whether it went through. */
const act = (run: (done: () => void) => void) =>
	new Promise<boolean>((resolve) => {
		try {
			run(() => resolve(!chrome.runtime.lastError))
		} catch {
			resolve(false)
		}
	})

const enabled = () => SETTINGS.get(OWN) !== false

const withoutOwn = (values: Record<string, unknown>) => {
	const { [OWN]: _own, ...rest } = values
	return rest
}

/** What was last sent, so a change that came from sync is not sent back. */
let lastSent: string | null = null
let sentChunks = 0

const readLocal = () =>
	call<Record<string, any>>((done) => chrome.storage.local.get(LOCAL_KEY, done)).then(
		(data) => (data?.[LOCAL_KEY] as LocalPayload | undefined) ?? null,
	)

const readSync = async () => {
	const sync = area()
	const data = sync ? await call<Record<string, any>>((done) => sync.get(null, done)) : null
	const header = data?.[HEADER] as Header | undefined

	if (!data || !header || !Number.isInteger(header.chunks)) {
		return null
	}

	sentChunks = Math.max(sentChunks, header.chunks)

	try {
		let text = ""

		for (let i = 0; i < header.chunks; i++) {
			const chunk = data[CHUNK + i]

			if (typeof chunk !== "string") {
				return null
			}

			text += chunk
		}

		return { header, values: JSON.parse(text) as Record<string, unknown>, text }
	} catch {
		return null
	}
}

/** Sends this device's settings, once it has joined, so a fresh one never sends its defaults first. */
const push = async (joining = false) => {
	const sync = area()
	const payload = await readLocal()

	if (!sync || !payload || !enabled() || !(joining || (await hasJoined()))) {
		return
	}

	const text = JSON.stringify(withoutOwn(payload.values ?? {}))

	if (text === lastSent) {
		return
	}

	if (text.length > MAX_CHARS) {
		console.warn("[btr] settings are too large to sync")
		return
	}

	const items: Record<string, unknown> = {}
	const chunks = Math.max(1, Math.ceil(text.length / CHUNK_CHARS))

	for (let i = 0; i < chunks; i++) {
		items[CHUNK + i] = text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)
	}

	items[HEADER] = {
		format: payload.format,
		savedAt: payload.savedAt ?? Date.now(),
		chunks,
	} satisfies Header

	if (!(await act((done) => sync.set(items, done)))) {
		return
	}

	// Pieces left over from a longer write.
	const stale = Array.from({ length: Math.max(0, sentChunks - chunks) }, (_, i) => CHUNK + (chunks + i))

	if (stale.length) {
		await act((done) => sync.remove(stale, done))
	}

	lastSent = text
	sentChunks = chunks
}

// Set once this device has taken part in sync. Before that, what is in sync
// wins: a fresh install may already have saved something, which is newer
// but would put near defaults over the settings it should be getting.
const JOINED_KEY = "btrSyncJoined"

const hasJoined = () =>
	call<Record<string, any>>((done) => chrome.storage.local.get(JOINED_KEY, done)).then(
		(data) => !!data?.[JOINED_KEY],
	)

const markJoined = () => act((done) => chrome.storage.local.set({ [JOINED_KEY]: true }, done))

/** Takes the synced settings when they are newer than this device's, keeping its own sync switch. */
const pull = async () => {
	const synced = await readSync()

	if (!synced || !enabled()) {
		return false
	}

	const local = await readLocal()

	if (local && (await hasJoined()) && (local.savedAt ?? 0) >= synced.header.savedAt) {
		return false
	}

	if (synced.header.format !== (local?.format ?? synced.header.format)) {
		return false
	}

	const values: Record<string, unknown> = withoutOwn(synced.values)

	if (local?.values?.[OWN] !== undefined) {
		values[OWN] = local.values[OWN]
	}

	lastSent = synced.text

	// Every context, this one included, applies it from the change event.
	await act((done) =>
		chrome.storage.local.set(
			{ [LOCAL_KEY]: { format: synced.header.format, values, savedAt: synced.header.savedAt } },
			done,
		),
	)

	return true
}

let pushTimer: ReturnType<typeof setTimeout> | null = null

const schedulePush = () => {
	if (pushTimer) {
		clearTimeout(pushTimer)
	}

	pushTimer = setTimeout(() => {
		pushTimer = null
		void push()
	}, PUSH_DELAY)
}

/** Newer from sync comes in, otherwise this device's goes out. */
const reconcile = async () => {
	if (!enabled()) {
		return
	}

	if (!(await pull())) {
		await push(true)
	}

	await markJoined()
}

export const startSettingsSync = (): void => {
	if (!area()) {
		return
	}

	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local" && changes[LOCAL_KEY]) {
			schedulePush()
		} else if (areaName === "sync" && changes[HEADER]) {
			void pull()
		}
	})

	SETTINGS.load(() => {
		void reconcile()
		SETTINGS.onChange(OWN, () => void reconcile())
	})
}
