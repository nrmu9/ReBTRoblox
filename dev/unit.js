"use strict"

// Runs the unit tests in test/unit with Node's own test runner. Each test is
// bundled first, so it can import from src through the @ alias like the
// extension does, with the few extension globals the code reads at load
// stubbed in by test/unit/setup.js.

const esbuild = require("esbuild")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const ROOT = path.join(__dirname, "..")
const TESTS = path.join(ROOT, "test", "unit")

const run = async () => {
	const files = fs.readdirSync(TESTS).filter((file) => file.endsWith(".test.ts"))
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "rebtroblox-unit-"))

	try {
		await esbuild.build({
			entryPoints: files.map((file) => path.join(TESTS, file)),
			outdir: out,
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "node20",
			alias: { "@": path.join(ROOT, "src") },
			inject: [path.join(TESTS, "setup.js")],
			define: { __DEV__: "false", __MV3__: "false" },
			logLevel: "error",
		})

		const result = spawnSync(
			process.execPath,
			["--test", ...files.map((file) => path.join(out, file.replace(/\.ts$/, ".js")))],
			{ stdio: "inherit" },
		)

		process.exitCode = result.status ?? 1
	} finally {
		fs.rmSync(out, { recursive: true, force: true })
	}
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
