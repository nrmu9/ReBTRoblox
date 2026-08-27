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
const target = (args.find((arg) => arg.startsWith("--target=")) || "--target=firefox").split("=")[1]

// content is a classic-script loader that imports main; main is ESM so esbuild
// can split the optional features, keeping three.js out of the initial download.
const CLASSIC = ["background", "content", "inject"]
const MODULE = ["main"]
const ASSETS = ["css", "img", "res"]

const entry = (name) => path.join(ROOT, "src/entries", `${name}.ts`)

const copyAssets = () => {
	for (const dir of ASSETS) {
		const from = path.join(ROOT, dir)
		if (fs.existsSync(from)) {
			fs.cpSync(from, path.join(OUT, dir), { recursive: true })
		}
	}
}

// One manifest.json in the repo root holds everything the two targets agree
// on. The MV2/MV3 differences live here, and the version comes from
// package.json, so a release is a single bump.
const TARGETS = {
	firefox: {
		manifest_version: 2,
		apply(manifest, shared) {
			manifest.browser_action = { default_title: shared.action_title }
			manifest.browser_specific_settings = {
				gecko: {
					id: "btroblox@antiboomz.com",
					strict_min_version: "128.0",
					data_collection_permissions: { required: ["none"] },
				},
			}
			// MV2 has no host_permissions: hosts go in permissions.
			manifest.permissions = [...shared.host_permissions, ...shared.permissions]
			manifest.web_accessible_resources = shared.web_accessible_resources
		},
	},

	chrome: {
		manifest_version: 3,
		apply(manifest, shared) {
			manifest.minimum_chrome_version = "111"
			manifest.incognito = "split"
			manifest.action = { default_title: shared.action_title }
			// Chrome blocks ads through declarativeNetRequest rather than webRequest.
			manifest.permissions = ["declarativeNetRequestWithHostAccess", ...shared.permissions]
			manifest.host_permissions = shared.host_permissions
			manifest.web_accessible_resources = [
				{
					resources: shared.web_accessible_resources,
					matches: ["*://*.roblox.com/*"],
				},
			]
		},
	},
}

const writeManifest = () => {
	const shared = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"))
	const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
	const spec = TARGETS[target]

	if (!spec) {
		throw new Error(`unknown target ${target}`)
	}

	const { action_title, permissions, host_permissions, web_accessible_resources, ...rest } = shared

	const manifest = {
		manifest_version: spec.manifest_version,
		...rest,
		version,
	}

	spec.apply(manifest, shared)

	manifest.background =
		target === "chrome" ? { service_worker: "js/background.js" } : { scripts: ["js/background.js"] }

	for (const entry of manifest.content_scripts) {
		entry.js = entry.world === "MAIN" ? ["js/inject.js"] : ["js/content.js"]
	}

	if (dev) {
		const hosts = target === "chrome" ? "host_permissions" : "permissions"

		manifest.name = "BTRoblox DEV"
		manifest.short_name = "BTRoblox_DEV"
		manifest[hosts] = [...manifest[hosts], BRIDGE_ORIGIN]
		manifest.permissions = [...new Set([...manifest.permissions, "tabs"])]

		if (target === "firefox") {
			manifest.content_security_policy = "script-src 'self' 'unsafe-eval'; object-src 'self'"
		}
	}

	fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n")
}

const shared = {
	bundle: true,
	outdir: path.join(OUT, "js"),
	target: "firefox128",
	// Dev builds are minified too, with sourcemaps in separate files rather than
	// inlined. An unminified eager bundle was roughly seven times the size, which
	// delayed the content script past the point where Roblox has already rendered,
	// so page hooks registered too late to catch anything.
	sourcemap: dev ? "linked" : false,
	minify: true,
	legalComments: "none",
	logLevel: "info",
	alias: { "@": path.join(ROOT, "src") },
	define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
}

const configs = [
	{ ...shared, entryPoints: CLASSIC.map(entry), format: "iife" },
	{ ...shared, entryPoints: MODULE.map(entry), format: "esm", splitting: true, chunkNames: "chunk-[hash]" },
]

const run = async () => {
	fs.rmSync(OUT, { recursive: true, force: true })
	fs.mkdirSync(path.join(OUT, "js"), { recursive: true })

	if (watch) {
		for (const config of configs) {
			const ctx = await esbuild.context(config)
			await ctx.watch()
		}
	} else {
		await Promise.all(configs.map((config) => esbuild.build(config)))
	}

	copyAssets()
	writeManifest()

	console.log(`built dist/ (${target}${dev ? ", dev" : ""})`)
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
