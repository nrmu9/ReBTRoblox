import { test } from "node:test"
import assert from "node:assert/strict"
import { sectionLabel } from "@/pages/home"

test("Home sections are named for the settings from their kind", () => {
	assert.equal(sectionLabel("friends"), "Friends")
	assert.equal(sectionLabel("feed:hero-unit"), "Banners")
	assert.equal(sectionLabel("feed:event-carousel"), "Event carousel")
})
