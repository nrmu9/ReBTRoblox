"use strict"

// Uploads the packaged chrome zip to the Chrome Web Store and submits it for
// review. Run by the release workflow; `--auth` is for the one time setup.
//
// Run it as `node dev/webstore.js --auth`, or through the npm scripts that
// carry the flags. `npm run <script> -- --auth` does not work: npm matches the
// flag against its own --auth-type and exits before the script is reached.
//
// The store's own API is called directly rather than through a wrapper: it is
// three requests, and the credentials are worth more than the lines a
// dependency would save.
//
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   oauth client
//   CWS_ITEM_ID                                           assigned by the store
//
// The item has to exist before any of this works. The API can only update a
// listing, so the first version is uploaded by hand in the developer console.

const fs = require("node:fs")
const path = require("node:path")
const readline = require("node:readline")

const ROOT = path.join(__dirname, "..")

// Overridable so the endpoints can be pointed at a local server in a test.
const OAUTH = process.env.CWS_OAUTH_URL || "https://oauth2.googleapis.com/token"
const API = process.env.CWS_API_URL || "https://www.googleapis.com"

const SCOPE = "https://www.googleapis.com/auth/chromewebstore"

// The store answers with these once the upload is in. Anything else is a
// failure, including the ones that read like progress.
const UPLOAD_OK = "SUCCESS"
const PUBLISH_OK = new Set(["OK", "ITEM_PENDING_REVIEW"])

const fail = (message) => {
	console.error(`::error::${message}`)
	process.exit(1)
}

const readJson = async (res) => {
	const text = await res.text()

	try {
		return JSON.parse(text)
	} catch {
		return { _raw: text }
	}
}

/** Never returned to the caller as part of anything printed. */
const getAccessToken = async ({ clientId, clientSecret, refreshToken }) => {
	const res = await fetch(OAUTH, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	})

	const json = await readJson(res)

	if (!res.ok || !json.access_token) {
		// invalid_grant is what an expired refresh token looks like, and it
		// expires in seven days while the oauth consent screen is still in
		// testing, which is the usual reason this breaks weeks later.
		fail(`could not get an access token: ${json.error || res.status} ${json.error_description || ""}`)
	}

	return json.access_token
}

const upload = async (token, itemId, zip) => {
	const res = await fetch(`${API}/upload/chromewebstore/v1.1/items/${itemId}?uploadType=media`, {
		method: "PUT",
		headers: { authorization: `Bearer ${token}`, "x-goog-api-version": "2" },
		body: fs.readFileSync(zip),
	})

	const json = await readJson(res)
	console.log("upload:", JSON.stringify(json))

	if (json.uploadState !== UPLOAD_OK) {
		const detail = (json.itemError ?? []).map((x) => x.error_detail).join("; ")
		fail(`upload rejected: ${json.uploadState ?? res.status} ${detail}`)
	}
}

const publish = async (token, itemId) => {
	const res = await fetch(`${API}/chromewebstore/v1.1/items/${itemId}/publish`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"x-goog-api-version": "2",
			"content-length": "0",
		},
	})

	const json = await readJson(res)
	console.log("publish:", JSON.stringify(json))

	const status = json.status ?? []

	if (!status.some((entry) => PUBLISH_OK.has(entry))) {
		fail(`publish rejected: ${status.join(", ") || res.status}`)
	}

	// A successful publish answers OK and says it is queued in statusDetail,
	// not in status, so the review has to be read from there.
	const pending = [...status, ...(json.statusDetail ?? [])].includes("ITEM_PENDING_REVIEW")

	console.log(pending ? "submitted for review" : "published")
}

/** Prints a refresh token for the values the developer pastes in. Local only. */
const auth = async () => {
	const ask = (question) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
		return new Promise((resolve) =>
			rl.question(question, (answer) => (rl.close(), resolve(answer.trim()))),
		)
	}

	const clientId = await ask("client id: ")
	const clientSecret = await ask("client secret: ")

	const url = new URL("https://accounts.google.com/o/oauth2/auth")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", "http://localhost")
	url.searchParams.set("response_type", "code")
	url.searchParams.set("scope", SCOPE)
	url.searchParams.set("access_type", "offline")
	// Google hands a refresh token back on the first consent only, so an
	// account that has already approved this client would otherwise get none.
	url.searchParams.set("prompt", "consent")

	console.log(`\nopen this, approve, then copy the "code" out of the url you land on:\n\n${url}\n`)

	const code = await ask("code: ")

	const res = await fetch(OAUTH, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: "authorization_code",
			redirect_uri: "http://localhost",
		}),
	})

	const json = await readJson(res)

	if (!json.refresh_token) {
		fail(`no refresh token came back: ${json.error || res.status} ${json.error_description || ""}`)
	}

	console.log(`\nrefresh token:\n\n${json.refresh_token}\n`)
	console.log("put it in the CWS_REFRESH_TOKEN repository secret. it is not stored here.")
}

const run = async () => {
	const args = process.argv.slice(2)

	if (args.includes("--auth")) {
		return auth()
	}

	const env = {
		clientId: process.env.CWS_CLIENT_ID,
		clientSecret: process.env.CWS_CLIENT_SECRET,
		refreshToken: process.env.CWS_REFRESH_TOKEN,
	}
	const itemId = process.env.CWS_ITEM_ID

	for (const [name, value] of Object.entries({ ...env, itemId })) {
		if (!value) {
			fail(`missing ${name}`)
		}
	}

	const zipArg = args.find((arg) => arg.startsWith("--zip="))?.slice(6)
	const zip = zipArg
		? path.resolve(ROOT, zipArg)
		: (() => {
				const dir = path.join(ROOT, "artifacts")
				const found = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => x.endsWith("-chrome.zip"))
				return found ? path.join(dir, found) : null
			})()

	if (!zip || !fs.existsSync(zip)) {
		fail("no chrome zip to upload, run npm run package first")
	}

	console.log(`uploading ${path.relative(ROOT, zip)} to item ${itemId}`)

	const token = await getAccessToken(env)

	await upload(token, itemId, zip)

	if (args.includes("--no-publish")) {
		console.log("uploaded as a draft, nothing submitted")
		return
	}

	await publish(token, itemId)
}

run().catch((err) => fail(String(err?.stack || err)))
