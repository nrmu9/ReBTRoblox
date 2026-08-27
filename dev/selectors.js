"use strict"

// Pulls the Roblox-targeting selectors out of the source so they can be checked
// against live pages. BTRoblox's own markup is skipped: it is ours, so it cannot
// drift out from under us.

const fs = require("node:fs")
const path = require("node:path")

const CALLS = ["\$watchAll", "\$watch", "\$findAll", "\$find", "\$req", "queryAll", "query", "querySelectorAll", "querySelector"]
const CALL_RE = new RegExp("(?:" + CALLS.join("|") + ")(?:<[^>]*>)?\(\s*([\"'`])((?:(?!\1)[^\\])*)\1", "g")
// Delegated handlers put the selector second: $on("click", ".sel", fn)
const ON_RE = /\$on(?:<[^>]*>)?\(\s*["'`][^"'`]+["'`]\s*,\s*(["'`])((?:(?!\1)[^\])*)\1/g

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
	const full = path.join(dir, e.name)
	return e.isDirectory() ? walk(full) : [full]
})

const isOurs = sel => /(^|[\s,>+~])[.#]btr[-_]/i.test(sel) || /\bbtr-/i.test(sel)
const isDynamic = sel => sel.includes("${")

const found = new Map()

for(const file of walk("src")) {
	if(!file.endsWith(".ts") || file.includes("core") || file.includes("entries")) { continue }

	const src = fs.readFileSync(file, "utf8")
	const rel = file.split(path.sep).join("/").replace("src/", "")

	for(const re of [CALL_RE, ON_RE]) {
		re.lastIndex = 0
		let m
		while((m = re.exec(src))) {
			const sel = m[2].trim()
			if(!sel || isOurs(sel) || isDynamic(sel)) { continue }
			// Skip bare tag names and things that are clearly not selectors.
			if(!/[.#\[]/.test(sel)) { continue }

			const line = src.slice(0, m.index).split("\n").length
			if(!found.has(sel)) { found.set(sel, []) }
			found.get(sel).push(rel + ":" + line)
		}
	}
}

const out = [...found.entries()]
	.map(([selector, sites]) => ({ selector, sites }))
	.sort((a, b) => a.sites[0].localeCompare(b.sites[0]))

fs.writeFileSync(process.argv[2] || "selectors.json", JSON.stringify(out, null, "\t") + "\n")
console.log("extracted " + out.length + " distinct Roblox selectors from " + new Set(out.flatMap(o => o.sites.map(s => s.split(":")[0]))).size + " files")
