"use strict"

// Pulls the Roblox-targeting selectors out of the source so they can be checked
// against live pages. ReBTRoblox's own markup is skipped: it is ours, so it cannot
// drift out from under us.

const fs = require("node:fs")
const path = require("node:path")

const CALLS = [
	"$watchAll",
	"$watch",
	"$findAll",
	"$find",
	"$req",
	"queryAll",
	"query",
	"querySelectorAll",
	"querySelector",
]
const ALT = CALLS.map((c) => c.replace("$", String.raw`\$`)).join("|")

// The three quote characters: " ' and backtick. Built from char codes so the
// backtick cannot terminate a template literal here.
const QCH = String.fromCharCode(34, 39, 96)
const Q = "[" + QCH + "]"
const NOT_Q = "[^" + QCH + "]"
// A quoted string, captured so the closing quote is matched to the opening one.
const QUOTED = String.raw`(${Q})((?:(?!\1)[^\\])*)\1`

const CALL_RE = new RegExp(String.raw`(?:${ALT})(?:<[^>]*>)?\(\s*${QUOTED}`, "g")
// Delegated handlers put the selector second: $on("click", ".sel", fn)
const ON_RE = new RegExp(String.raw`\$on(?:<[^>]*>)?\(\s*${Q}${NOT_Q}+${Q}\s*,\s*${QUOTED}`, "g")

const walk = (dir) =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name)
		return e.isDirectory() ? walk(full) : [full]
	})

const isOurs = (sel) => /(^|[\s,>+~])[.#]btr[-_]/i.test(sel) || /\bbtr-/i.test(sel)
const isDynamic = (sel) => sel.includes("${")

const found = new Map()

for (const file of walk("src")) {
	// core/ defines the helpers rather than calling them with real selectors.
	if (!file.endsWith(".ts") || file.includes(path.join("src", "core"))) {
		continue
	}

	// Comments are blanked rather than removed so line numbers still line up.
	// Angular's own $watch takes an expression, not a selector.
	const blank = (m) => " ".repeat(m.length)
	const src = fs
		.readFileSync(file, "utf8")
		.replace(/\/\*[^]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/\/\/[^\n]*/g, blank)
		.replace(/\$scope\s*\.\s*\$watch/g, "$scope.__ngwatch")
	const rel = file.split(path.sep).join("/").replace("src/", "")

	for (const re of [CALL_RE, ON_RE]) {
		re.lastIndex = 0
		let m
		while ((m = re.exec(src))) {
			const sel = m[2].trim()
			if (!sel || isOurs(sel) || isDynamic(sel)) {
				continue
			}
			// Skip bare tag names and anything that is clearly not a selector.
			if (!/[.#[]/.test(sel)) {
				continue
			}

			const line = src.slice(0, m.index).split("\n").length
			if (!found.has(sel)) {
				found.set(sel, [])
			}
			found.get(sel).push(rel + ":" + line)
		}
	}
}

const out = [...found.entries()]
	.map(([selector, sites]) => ({ selector, sites }))
	.toSorted((a, b) => a.sites[0].localeCompare(b.sites[0]))

const files = new Set(out.flatMap((o) => o.sites.map((s) => s.split(":")[0])))

fs.writeFileSync(process.argv[2] || "selectors.json", JSON.stringify(out, null, "\t") + "\n")
console.log(`extracted ${out.length} distinct Roblox selectors from ${files.size} files`)
