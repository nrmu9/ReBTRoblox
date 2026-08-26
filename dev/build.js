"use strict"

// Writes manifest.json for the Firefox DEV build.

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const BRIDGE_ORIGIN = "http://127.0.0.1:8787/*"

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.firefox.json"), "utf8"))

manifest.name = "BTRoblox DEV"
manifest.short_name = "BTRoblox_DEV"
manifest.permissions = [...manifest.permissions, BRIDGE_ORIGIN, "tabs"]
manifest.content_security_policy = "script-src 'self' 'unsafe-eval'; object-src 'self'"
manifest.background.scripts.push("js/devbridge.js")

for(const entry of manifest.content_scripts) {
	const index = entry.js.indexOf("js/utility.js")
	if(index !== -1) { entry.js.splice(index + 1, 0, "js/devprobe.js") }
}

fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n")
console.log("wrote manifest.json (BTRoblox_DEV)")
