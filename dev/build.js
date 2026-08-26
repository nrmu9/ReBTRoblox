"use strict"

// Builds the extension into dist/. Pass --dev for the bridge-enabled build,
// --watch to rebuild on change, --target=chrome for the MV3 manifest.

const esbuild = require("esbuild")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "dist")
const BRIDGE_ORIGIN = "http://127.0.0.1:8787/*"

const args = process.argv.slice(2)
const dev = args.includes("--dev")
const watch = args.includes("--watch")
const target = (args.find(arg => arg.startsWith("--target=")) || "--target=firefox").split("=")[1]

// content is a classic-script loader that imports main; main is ESM so esbuild
// can split the optional features, keeping three.js out of the initial download.
const CLASSIC = ["background", "content", "inject"]
const MODULE = ["main"]
const ASSETS = ["css", "img", "res", "lib"]

const entry = name => path.join(ROOT, "src/entries", `${name}.ts`)

const copyAssets = () => {
	for(const dir of ASSETS) {
		const from = path.join(ROOT, dir)
		if(fs.existsSync(from)) { fs.cpSync(from, path.join(OUT, dir), { recursive: true }) }
	}
}

const writeManifest = () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, `manifest.${target}.json`), "utf8"))
	const hosts = target === "chrome" ? "host_permissions" : "permissions"

	manifest.background = target === "chrome"
		? { service_worker: "js/background.js" }
		: { scripts: ["js/background.js"] }

	for(const entry of manifest.content_scripts) {
		entry.js = entry.world === "MAIN" ? ["js/inject.js"] : ["js/content.js"]
	}

	if(dev) {
		manifest.name = "BTRoblox DEV"
		manifest.short_name = "BTRoblox_DEV"
		manifest[hosts] = [...manifest[hosts], BRIDGE_ORIGIN]
		manifest.permissions = [...new Set([...manifest.permissions, "tabs"])]

		if(target === "firefox") {
			manifest.content_security_policy = "script-src 'self' 'unsafe-eval'; object-src 'self'"
		}
	}

	fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n")
}

const shared = {
	bundle: true,
	outdir: path.join(OUT, "js"),
	target: "firefox128",
	sourcemap: dev ? "inline" : false,
	minify: !dev,
	legalComments: "none",
	logLevel: "info",
	alias: { "@": path.join(ROOT, "src") },
	define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") }
}

const configs = [
	{ ...shared, entryPoints: CLASSIC.map(entry), format: "iife" },
	{ ...shared, entryPoints: MODULE.map(entry), format: "esm", splitting: true, chunkNames: "chunk-[hash]" }
]

const run = async () => {
	fs.rmSync(OUT, { recursive: true, force: true })
	fs.mkdirSync(path.join(OUT, "js"), { recursive: true })

	if(watch) {
		for(const config of configs) {
			const ctx = await esbuild.context(config)
			await ctx.watch()
		}
	} else {
		await Promise.all(configs.map(config => esbuild.build(config)))
	}

	copyAssets()
	writeManifest()

	console.log(`built dist/ (${target}${dev ? ", dev" : ""})`)
}

run().catch(err => {
	console.error(err)
	process.exit(1)
})
