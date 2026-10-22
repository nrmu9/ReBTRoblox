import { test } from "node:test"
import assert from "node:assert/strict"
import { fileKey, lookUpAsset } from "@/rbx/AssetLookup"

// No IndexedDB in Node, so nothing is remembered across calls but what the
// module keeps in memory, which is what these look at.

const expires = Math.floor(Date.now() / 1000) + 86400
let batches: string[][] = []
let refuse = new Set<number>()
let missing = new Set<number>()

globalThis.fetch = (async (_url: string, init: RequestInit) => {
	const body = JSON.parse(String(init.body)) as Array<{ requestId: string; assetId: number }>
	batches.push(body.map((entry) => entry.requestId))

	return {
		ok: true,
		json: async () =>
			body.map((entry) => {
				if (missing.has(entry.assetId)) {
					return { requestId: entry.requestId, errors: [{ code: 404 }] }
				}

				if (refuse.has(entry.assetId)) {
					refuse.delete(entry.assetId)
					return { requestId: entry.requestId, errors: [{ code: 429 }] }
				}

				return {
					requestId: entry.requestId,
					assetTypeId: 8,
					locations: [
						{
							location: `https://c0.rbxcdn.com/${entry.assetId.toString(16).padStart(32, "0")}?Expires=${expires}`,
						},
					],
				}
			}),
	}
}) as unknown as typeof fetch

test("lookups go out together, at most fifty at a time", async () => {
	batches = []
	const ids = Array.from({ length: 60 }, (_, i) => 1000 + i)
	const found = await Promise.all(ids.map((id) => lookUpAsset(id)))

	assert.deepEqual(
		batches.map((batch) => batch.length),
		[50, 10],
	)
	assert.ok(found.every((entry) => entry?.assetTypeId === 8))
})

test("a link looked up before is not asked for again", async () => {
	batches = []
	await lookUpAsset(1005)
	assert.equal(batches.length, 0)
})

test("a refused lookup is tried again, a missing asset is not", async () => {
	batches = []
	refuse = new Set([2001])
	missing = new Set([2002])

	const [refused, gone] = await Promise.all([lookUpAsset(2001), lookUpAsset(2002)])

	assert.ok(refused, "the refused one comes back on a later try")
	assert.equal(gone, null)
	assert.ok(batches.length >= 2)
	assert.ok(
		!batches.slice(1).some((batch) => batch.includes("2002")),
		"the missing one is not asked for again",
	)
})

test("files are known by their content hash and encoding", () => {
	const hash = "d1822cd8c5785e92dcaacd2143e6725e"
	const a = fileKey(`https://fts.rbxcdn.com/sc5/${hash}?encoding=zstd&Expires=1&Signature=a`)
	const b = fileKey(`https://fts.rbxcdn.com/sc5/${hash}?encoding=zstd&Expires=2&Signature=b`)

	assert.equal(a, `${hash}:zstd`)
	assert.equal(a, b, "a fresh link to the same file is the same file")
	assert.equal(fileKey("https://example.com/d1822cd8c5785e92dcaacd2143e6725e"), null)
	assert.equal(fileKey("https://fts.rbxcdn.com/no-hash-here"), null)
})
