"use strict"

// Runs the esbuild watcher and the bridge server together.

const { fork } = require("node:child_process")
const path = require("node:path")

const children = [
	fork(path.join(__dirname, "build.js"), ["--dev", "--watch"], { stdio: "inherit" }),
	fork(path.join(__dirname, "bridge.js"), [], { stdio: "inherit" })
]

const shutdown = () => {
	for(const child of children) { child.kill() }
	process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

for(const child of children) {
	child.on("exit", code => {
		if(code) { shutdown() }
	})
}
