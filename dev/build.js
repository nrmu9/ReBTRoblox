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
const ASSETS = ["css", "res"]

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
			// data_collection_permissions landed in 140 on desktop and 142 on
			// android, and AMO warns when the floor predates the keys in the
			// manifest. 128 was the previous esr and went end of life in
			// September 2025, so nothing is lost by moving up to where the
			// manifest is actually understood.
			manifest.browser_specific_settings = {
				gecko: {
					id: "btroblox@nrmu.eu",
					strict_min_version: "140.0",
					data_collection_permissions: { required: ["none"] },
				},
				gecko_android: {
					strict_min_version: "142.0",
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

	// AMO rejects the submission outright past these, and it does so after a
	// tag is already pushed, so the build refuses first.
	const LIMITS = { name: 45, short_name: 12, description: 132 }

	for (const [key, limit] of Object.entries(LIMITS)) {
		if (manifest[key] && manifest[key].length > limit) {
			throw new Error(
				`manifest ${key} is ${manifest[key].length} characters, over the ${limit} AMO allows`,
			)
		}
	}

	spec.apply(manifest, shared)

	manifest.background =
		target === "chrome" ? { service_worker: "js/background.js" } : { scripts: ["js/background.js"] }

	for (const entry of manifest.content_scripts) {
		entry.js = entry.world === "MAIN" ? ["js/inject.js"] : ["js/content.js"]
	}

	if (dev) {
		const hosts = target === "chrome" ? "host_permissions" : "permissions"

		manifest.name = "ReBTRoblox DEV"
		manifest.short_name = "ReBTRoblox_DEV"
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
	// Matches strict_min_version above: there is no point emitting syntax for
	// a firefox the manifest refuses to install on.
	target: "firefox140",
	// Dev builds are minified too, with sourcemaps in separate files rather than
	// inlined. An unminified eager bundle was roughly seven times the size, which
	// delayed the content script past the point where Roblox has already rendered,
	// so page hooks registered too late to catch anything.
	sourcemap: dev ? "linked" : false,
	minify: true,
	legalComments: "none",
	logLevel: "info",
	alias: { "@": path.join(ROOT, "src") },
	// __DEV__ is folded at build time so esbuild can drop dev-only branches and the
	// modules they import. IS_DEV_MODE is read from the manifest at runtime and can
	// never be eliminated, so it alone would ship the dev bridge in production.
	define: {
		"process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
		__DEV__: JSON.stringify(dev),
	},
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
