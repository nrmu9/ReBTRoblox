import { test } from "node:test"
import assert from "node:assert/strict"
import { markupWithMarkers } from "@/core/html"

const markup = (pieces: TemplateStringsArray, ..._args: unknown[]) => markupWithMarkers(pieces)

test("A line break between text and a value reads as a space", () => {
	const date = "Jul 4, 2026"
	assert.equal(
		markup`<span class="btr-unlock-date">
			Unlocked
			${date}
		</span>`,
		'<span class="btr-unlock-date">Unlocked !btr0!</span>',
	)
	assert.equal(
		markup`<span>
			${date}
			ago
		</span>`,
		"<span>!btr0! ago</span>",
	)
})

test("Breaks next to tags are only indentation", () => {
	assert.equal(
		markup`<div>
			<span>${1}</span>
			<span>them.
			Those</span>
		</div>`,
		"<div><span>!btr0!</span><span>them. Those</span></div>",
	)
})
