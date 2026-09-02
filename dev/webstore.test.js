"use strict"

// Runs dev/webstore.js against a fake Chrome Web Store and checks each outcome.
const http = require("node:http")
const { execFile } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const SCRIPT = path.join(__dirname, "webstore.js")
const ZIP = path.join(require("node:os").tmpdir(), "btr-fake-chrome.zip")

fs.writeFileSync(ZIP, Buffer.from("PK\u0005\u0006" + "\0".repeat(18), "binary"))

let scenario = "ok"
const seen = []

const server = http.createServer((req, res) => {
	let body = ""
	req.on("data", (c) => (body += c))
	req.on("end", () => {
		const send = (code, json) => {
			res.writeHead(code, { "content-type": "application/json" })
			res.end(JSON.stringify(json))
		}

		if (req.url === "/token") {
			seen.push(["token", req.method, body.includes("grant_type=refresh_token")])
			if (scenario === "badToken") {
				return send(400, {
					error: "invalid_grant",
					error_description: "Token has been expired or revoked.",
				})
			}
			return send(200, { access_token: "test-access-token", expires_in: 3600 })
		}

		if (req.url.startsWith("/upload/chromewebstore/v1.1/items/")) {
			seen.push([
				"upload",
				req.method,
				req.headers.authorization,
				req.headers["x-goog-api-version"],
				body.length,
			])
			if (scenario === "badUpload") {
				return send(200, {
					uploadState: "FAILURE",
					itemError: [{ error_detail: "manifest version is too low" }],
				})
			}
			return send(200, { uploadState: "SUCCESS", id: "abc" })
		}

		if (req.url.startsWith("/chromewebstore/v1.1/items/")) {
			seen.push(["publish", req.method, req.headers.authorization])
			if (scenario === "badPublish") {
				return send(200, { status: ["ITEM_NOT_UPDATABLE"], statusDetail: ["not updatable"] })
			}
			return send(200, { status: ["OK"], statusDetail: ["ITEM_PENDING_REVIEW"] })
		}

		send(404, { error: "not found" })
	})
})

const run = (args, env) =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[SCRIPT, ...args],
			{
				cwd: ROOT,
				env: {
					...process.env,
					CWS_CLIENT_ID: "id",
					CWS_CLIENT_SECRET: "secret",
					CWS_REFRESH_TOKEN: "refresh",
					CWS_ITEM_ID: "itemid123",
					CWS_OAUTH_URL: `http://127.0.0.1:${server.address().port}/token`,
					CWS_API_URL: `http://127.0.0.1:${server.address().port}`,
					...env,
				},
			},
			(err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
		)
	})

const main = async () => {
	await new Promise((r) => server.listen(0, "127.0.0.1", r))

	let failed = 0
	const check = (label, ok, detail = "") => {
		console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`)
		if (!ok) failed++
	}

	{
		seen.length = 0
		scenario = "ok"
		const out = await run([`--zip=${ZIP}`])
		check("happy path exits 0", out.code === 0, out.stderr.trim())
		check("submitted for review", out.stdout.includes("submitted for review"))
		check(
			"token, upload, publish in order",
			seen.map((s) => s[0]).join(",") === "token,upload,publish",
			seen.map((s) => s[0]).join(","),
		)
		check(
			"upload used PUT with the bearer token",
			seen[1][1] === "PUT" && seen[1][2] === "Bearer test-access-token",
		)
		check("upload sent the zip", seen[1][4] > 0)
		check(
			"the access token is never printed",
			!out.stdout.includes("test-access-token") && !out.stderr.includes("test-access-token"),
		)
	}

	{
		seen.length = 0
		scenario = "ok"
		const out = await run([`--zip=${ZIP}`, "--no-publish"])
		check(
			"--no-publish stops after the upload",
			out.code === 0 && seen.map((s) => s[0]).join(",") === "token,upload",
		)
	}

	{
		scenario = "badToken"
		const out = await run([`--zip=${ZIP}`])
		check("expired refresh token fails the release", out.code === 1)
		check("says what went wrong", out.stderr.includes("invalid_grant"), out.stderr.trim())
	}

	{
		scenario = "badUpload"
		const out = await run([`--zip=${ZIP}`])
		check("rejected upload fails the release", out.code === 1)
		check(
			"carries the store's reason",
			out.stderr.includes("manifest version is too low"),
			out.stderr.trim(),
		)
	}

	{
		scenario = "badPublish"
		const out = await run([`--zip=${ZIP}`])
		check("rejected publish fails the release", out.code === 1)
		check("names the status", out.stderr.includes("ITEM_NOT_UPDATABLE"), out.stderr.trim())
	}

	{
		scenario = "ok"
		const out = await run([`--zip=${ZIP}`], { CWS_ITEM_ID: "" })
		check(
			"missing config fails before any request",
			out.code === 1 && out.stderr.includes("missing itemId"),
		)
	}

	{
		scenario = "ok"
		const out = await run(["--zip=does-not-exist.zip"])
		check("missing zip fails with advice", out.code === 1 && out.stderr.includes("npm run package"))
	}

	server.close()
	fs.unlinkSync(ZIP)

	console.log(failed ? `\n${failed} failing` : "\nall passing")
	process.exit(failed ? 1 : 0)
}

main()
