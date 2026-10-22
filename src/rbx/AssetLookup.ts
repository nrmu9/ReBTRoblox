// Asset lookups: the step that turns an asset id into a link on Roblox's CDN.
// An avatar needs dozens, so they go out together in batches, a refused one
// is tried again, and each link is remembered until shortly before it
// expires. Remembered links also let the browser's cache serve the files,
// as a fresh lookup hands out a different link to the same file each time.

export interface AssetLocation {
	locations: Array<{ location: string }>
	assetTypeId?: number | undefined
}

interface Remembered {
	location: string
	assetTypeId?: number | undefined
	expires: number
}

const BATCH_URL = "https://assetdelivery.roblox.com/v2/assets/batch"
const BATCH_SIZE = 50
const BATCH_WAIT = 10
const RETRIES = 3
// A link is used up to this long before it expires, then asked for again.
const MARGIN = 10 * 60e3
const DEFAULT_LIFE = 60 * 60e3

const remembered = new Map<string, Remembered>()

// Links are kept in the page's own database, so they last across pages.
let dbPromise: Promise<IDBDatabase | null> | null = null

const openDb = () =>
	(dbPromise ??= new Promise((resolve) => {
		try {
			const request = indexedDB.open("rebtroblox-assets", 1)
			request.onupgradeneeded = () => request.result.createObjectStore("locations")
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => resolve(null)
		} catch {
			resolve(null)
		}
	}))

const readStored = async (key: string): Promise<Remembered | null> => {
	const db = await openDb()

	if (!db) {
		return null
	}

	return new Promise((resolve) => {
		try {
			const request = db.transaction("locations").objectStore("locations").get(key)
			request.onsuccess = () => resolve(request.result ?? null)
			request.onerror = () => resolve(null)
		} catch {
			resolve(null)
		}
	})
}

const writeStored = async (key: string, value: Remembered | null) => {
	const db = await openDb()

	try {
		const store = db?.transaction("locations", "readwrite").objectStore("locations")

		if (value) {
			store?.put(value, key)
		} else {
			store?.delete(key)
		}
	} catch {}
}

/** When a CDN link stops working, from its own Expires, in milliseconds. */
const expiryOf = (location: string) => {
	const seconds = Number(location.match(/[?&]Expires=(\d+)/)?.[1] ?? location.match(/exp=(\d+)/)?.[1])
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now() + DEFAULT_LIFE
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Pending {
	key: string
	body: { requestId: string; assetId: number; version?: number }
	resolve: (value: AssetLocation | null) => void
	tries: number
}

const queue: Pending[] = []
let timer: ReturnType<typeof setTimeout> | null = null

const remember = (key: string, entry: any) => {
	const location = entry?.locations?.[0]?.location

	if (typeof location !== "string") {
		return null
	}

	const value: Remembered = { location, assetTypeId: entry.assetTypeId, expires: expiryOf(location) }
	remembered.set(key, value)
	void writeStored(key, value)
	return { locations: [{ location }], assetTypeId: entry.assetTypeId }
}

const send = async (batch: Pending[]) => {
	let results: any[] | null = null

	for (let attempt = 0; attempt < RETRIES && !results; attempt++) {
		if (attempt) {
			await sleep(400 * 3 ** (attempt - 1))
		}

		const res = await fetch(BATCH_URL, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(batch.map((pending) => pending.body)),
		}).catch(() => null)

		if (res?.ok) {
			results = await res.json().catch(() => null)
		}
	}

	const byId = new Map<string, any>((Array.isArray(results) ? results : []).map((entry) => [entry?.requestId, entry]))
	const again: Pending[] = []

	for (const pending of batch) {
		const entry = byId.get(pending.body.requestId)
		const found = remember(pending.key, entry)
		// A missing or moderated asset says so with a 4xx and stays that way.
		const final = entry?.errors?.some((error: any) => error?.code >= 400 && error.code < 500 && error.code !== 429)

		if (found) {
			pending.resolve(found)
		} else if (!final && ++pending.tries < RETRIES && results) {
			// Refused on its own inside a batch that went through, such as a rate
			// limit on that one asset, so it waits a little and goes again.
			again.push(pending)
		} else {
			pending.resolve(null)
		}
	}

	if (again.length) {
		await sleep(600)
		queue.push(...again)
		schedule()
	}
}

const flush = () => {
	timer = null

	while (queue.length) {
		void send(queue.splice(0, BATCH_SIZE))
	}
}

const schedule = () => {
	if (queue.length >= BATCH_SIZE) {
		flush()
	} else {
		timer ??= setTimeout(flush, BATCH_WAIT)
	}
}

/** Where an asset can be downloaded, or null if Roblox would not say. */
export const lookUpAsset = async (assetId: number, version?: number): Promise<AssetLocation | null> => {
	const key = version ? `${assetId}@${version}` : String(assetId)
	const known = remembered.get(key) ?? (await readStored(key))

	if (known && known.expires - MARGIN > Date.now()) {
		remembered.set(key, known)
		return { locations: [{ location: known.location }], assetTypeId: known.assetTypeId }
	}

	return new Promise((resolve) => {
		queue.push({
			key,
			body: { requestId: key, assetId, ...(version ? { version } : {}) },
			resolve,
			tries: 0,
		})
		schedule()
	})
}

/** Forgets an asset's link, for when it stopped working before it should have. */
export const forgetAsset = (assetId: number, version?: number) => {
	const key = version ? `${assetId}@${version}` : String(assetId)
	remembered.delete(key)
	void writeStored(key, null)
}
