"use strict"

// Bundles the browser tests and serves them. Open the printed URL and read the page.

const esbuild = require("esbuild")
const http = require("node:http")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const PORT = 8790

const page = `<!doctype html><meta charset="utf-8"><title>running</title><body>`

const run = async () => {
	const built = await esbuild.build({
		entryPoints: [path.join(__dirname, "hook.test.ts")],
		bundle: true,
		write: false,
		format: "iife",
		alias: { "@": path.join(ROOT, "src") }
	})

	const script = built.outputFiles[0].text

	http.createServer((req, res) => {
		const js = req.url.endsWith(".js")

		res.writeHead(200, {
			"content-type": js ? "text/javascript" : "text/html",
			"cache-control": "no-store"
		})

		res.end(js ? script : `${page}<script src="test.js"></script>`)
	}).listen(PORT, "127.0.0.1", () => console.log(`tests on http://127.0.0.1:${PORT}`))
}

run().catch(err => {
	console.error(err)
	process.exit(1)
})
