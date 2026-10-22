import { test } from "node:test"
import assert from "node:assert/strict"
import { userNames } from "@/feat/activity/users"

test("names are asked for a hundred at a time, banned users included", async () => {
	const bodies: any[] = []

	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body))
		bodies.push(body)

		return {
			ok: true,
			json: async () => ({
				data: body.userIds.map((id: number) => ({
					id,
					name: `user${id}`,
					displayName: `User ${id}`,
				})),
			}),
		}
	}) as unknown as typeof fetch

	const ids = Array.from({ length: 150 }, (_, i) => i + 1)
	const names = await userNames(ids)

	assert.deepEqual(
		bodies.map((body) => body.userIds.length),
		[100, 50],
	)
	assert.ok(bodies.every((body) => body.excludeBannedUsers === false))
	assert.deepEqual(names.get(150), { name: "user150", displayName: "User 150" })
})

test("a failed request gives what it has rather than throwing", async () => {
	globalThis.fetch = (async () => {
		throw new Error("offline")
	}) as unknown as typeof fetch

	const names = await userNames([1, 2])
	assert.equal(names.size, 0)
})
