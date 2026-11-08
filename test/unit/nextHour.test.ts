import { test } from "node:test"
import assert from "node:assert/strict"
import { nextHour } from "@/feat/activity/shared"

const MINUTE = 60e3
const HOUR = 60 * MINUTE

const withTimeZone = (zone: string, fn: () => void) => {
	const before = process.env.TZ
	process.env.TZ = zone

	try {
		fn()
	} finally {
		if (before === undefined) {
			delete process.env.TZ
		} else {
			process.env.TZ = before
		}
	}
}

// Every zone's night the clocks go back in 2026, and Lord Howe's half hour one.
const CHANGES: Array<[string, number]> = [
	["Europe/Warsaw", Date.UTC(2026, 9, 25, 1)],
	["America/New_York", Date.UTC(2026, 10, 1, 6)],
	["Australia/Lord_Howe", Date.UTC(2026, 3, 4, 15)],
]

for (const [zone, change] of CHANGES) {
	test(`always moves forward around the clock change in ${zone}`, () => {
		withTimeZone(zone, () => {
			for (let time = change - 3 * HOUR; time < change + 3 * HOUR; time += MINUTE / 2) {
				const next = nextHour(time)

				assert.ok(next > time, new Date(time).toISOString())
				assert.ok(next - time <= HOUR, new Date(time).toISOString())
				assert.equal(new Date(next).getMinutes() % 30, 0, new Date(time).toISOString())
			}
		})
	})
}

test("walking hour by hour over the night the clocks go back reaches the end", () => {
	withTimeZone("Europe/Warsaw", () => {
		// The second 2:30, where this used to go round forever.
		let from = Date.UTC(2026, 9, 25, 1, 30)
		const end = from + 2 * HOUR
		let steps = 0

		while (from < end) {
			from = Math.min(end, nextHour(from))
			assert.ok(++steps < 10)
		}

		assert.equal(from, end)
	})
})

test("lands on the start of the hour", () => {
	withTimeZone("Europe/Warsaw", () => {
		assert.equal(new Date(nextHour(new Date(2026, 5, 1, 14, 20, 30, 5).getTime())).getHours(), 15)
		assert.equal(new Date(nextHour(new Date(2026, 5, 1, 14, 20, 30, 5).getTime())).getMinutes(), 0)
		assert.equal(nextHour(new Date(2026, 5, 1, 14).getTime()), new Date(2026, 5, 1, 15).getTime())
	})
})
