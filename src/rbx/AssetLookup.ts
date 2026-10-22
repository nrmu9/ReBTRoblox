import { delay } from "@/core/util"
// Asset lookups: the step that turns an asset id into a link on Roblox's CDN.
// An avatar needs dozens, so they go out together in batches, a refused one
// is tried again, and each link is remembered until shortly before it
// expires. The files themselves are kept too, by their content, so anything
// seen before loads without downloading it again.

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

// Links and files are kept in the page's own database, so they last across pages.
let dbPromise: Promise<IDBDatabase | null> | null = null

const openDb = () =>
	(dbPromise ??= new Promise((resolve) => {
		// Loading never waits long on it: without it, everything is fetched.
		const giveUp = setTimeout(() => resolve(null), 2000)
		const done = (db: IDBDatabase | null) => {
			clearTimeout(giveUp)
			resolve(db)
		}

		try {
			const request = indexedDB.open("rebtroblox-assets", 2)

			request.onupgradeneeded = () => {
				const db = request.result

				for (const name of ["locations", "files"]) {
					if (!db.objectStoreNames.contains(name)) {
						db.createObjectStore(name)
					}
				}

				if (!db.objectStoreNames.contains("fileInfo")) {
					db.createObjectStore("fileInfo").createIndex("used", "used")
				}
			}

			request.onsuccess = () => {
				const db = request.result

				// A newer version in another tab waits on this one, so it steps aside.
				db.onversionchange = () => {
					db.close()
					dbPromise = null
				}

				done(db)
			}

			request.onerror = () => done(null)
		} catch {
			done(null)
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
			await delay(400 * 3 ** (attempt - 1))
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

	const byId = new Map<string, any>(
		(Array.isArray(results) ? results : []).map((entry) => [entry?.requestId, entry]),
	)
	const again: Pending[] = []

	for (const pending of batch) {
		const entry = byId.get(pending.body.requestId)
		const found = remember(pending.key, entry)
		// A missing or moderated asset says so with a 4xx and stays that way.
		const final = entry?.errors?.some(
			(error: any) => error?.code >= 400 && error.code < 500 && error.code !== 429,
		)

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
		await delay(600)
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

// Files, kept by the content hash in their link, so a changed asset, which
// gets a new hash, is never served from here. The oldest used go first past
// the cap, and their sizes are kept apart so trimming never reads a file.
const FILE_CAP = 200 * 1024 * 1024
// How stale a file's last use may get before a hit writes it down again.
const USED_SLACK = 24 * 60 * 60e3

interface FileInfo {
	size: number
	used: number
}

/** The file's identity in a CDN link: its hash, and how it is encoded. Null for any other link. */
export const fileKey = (url: string) => {
	try {
		const parsed = new URL(url)
		const hash = parsed.pathname.match(/\/([0-9a-f]{32})(?:\/|$)/i)?.[1]

		if (!hash || !parsed.hostname.endsWith(".rbxcdn.com")) {
			return null
		}

		return `${hash.toLowerCase()}:${parsed.searchParams.get("encoding") ?? ""}`
	} catch {
		return null
	}
}

const request = <T>(req: IDBRequest<T>) =>
	new Promise<T | null>((resolve) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => resolve(null)
	})

/** A file downloaded before from this link's content, or null. */
export const readFile = async (url: string): Promise<ArrayBuffer | null> => {
	const key = fileKey(url)
	const db = key ? await openDb() : null

	if (!key || !db) {
		return null
	}

	try {
		const tx = db.transaction(["files", "fileInfo"])
		const [data, info] = await Promise.all([
			request<ArrayBuffer | undefined>(tx.objectStore("files").get(key)),
			request<FileInfo | undefined>(tx.objectStore("fileInfo").get(key)),
		])

		// Not instanceof: in a Firefox content script it comes from the page's side.
		if (typeof data?.byteLength !== "number") {
			return null
		}

		if (info && Date.now() - info.used > USED_SLACK) {
			db.transaction("fileInfo", "readwrite")
				.objectStore("fileInfo")
				.put({ size: info.size, used: Date.now() }, key)
		}

		// A copy of our own: in a Firefox content script the stored one belongs to
		// the page, which typed arrays and instanceof checks refuse. slice() would
		// still be the page's, structuredClone is not.
		return structuredClone(data)
	} catch {
		return null
	}
}

let trimming = false

/** Drops the files used longest ago until what is kept fits the cap. */
const trim = async (db: IDBDatabase) => {
	if (trimming) {
		return
	}

	trimming = true

	try {
		// Oldest used first, sizes and keys read together so they line up.
		const index = db.transaction("fileInfo").objectStore("fileInfo").index("used")
		const [infos, keys] = await Promise.all([request(index.getAll()), request(index.getAllKeys())])

		if (!infos || !keys) {
			return
		}

		let total = infos.reduce((sum: number, info: FileInfo) => sum + info.size, 0)

		if (total <= FILE_CAP) {
			return
		}

		const tx = db.transaction(["files", "fileInfo"], "readwrite")

		for (let i = 0; i < keys.length && total > FILE_CAP * 0.9; i++) {
			tx.objectStore("files").delete(keys[i])
			tx.objectStore("fileInfo").delete(keys[i])
			total -= infos[i].size
		}
	} catch {
	} finally {
		trimming = false
	}
}

let stored = 0

/** Keeps a downloaded file for next time. */
export const storeFile = async (url: string, data: ArrayBuffer) => {
	const key = fileKey(url)
	const db = key ? await openDb() : null

	if (!key || !db || data.byteLength > FILE_CAP / 10) {
		return
	}

	try {
		const tx = db.transaction(["files", "fileInfo"], "readwrite")
		tx.objectStore("files").put(data, key)
		tx.objectStore("fileInfo").put({ size: data.byteLength, used: Date.now() }, key)
	} catch {
		return
	}

	// Checked now and then rather than on every file.
	if (stored++ % 25 === 0) {
		void trim(db)
	}
}

/** Forgets a kept file, for one that did not load. */
export const dropFile = async (url: string) => {
	const key = fileKey(url)
	const db = key ? await openDb() : null

	if (!key || !db) {
		return
	}

	try {
		const tx = db.transaction(["files", "fileInfo"], "readwrite")
		tx.objectStore("files").delete(key)
		tx.objectStore("fileInfo").delete(key)
	} catch {}
}
