"use strict"

// Runs the esbuild watcher and the bridge server together.

const { fork } = require("node:child_process")
const path = require("node:path")

// Anything after the script name goes to the builder, so a target or an
// output directory can be chosen without a script per combination.
const args = process.argv.slice(2)

const children = [
	fork(path.join(__dirname, "build.js"), ["--dev", "--watch", ...args], { stdio: "inherit" }),
	fork(path.join(__dirname, "bridge.js"), [], { stdio: "inherit" }),
]

const shutdown = () => {
	for (const child of children) {
		child.kill()
	}
	process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

for (const child of children) {
	child.on("exit", (code) => {
		if (code) {
			shutdown()
		}
	})
}
