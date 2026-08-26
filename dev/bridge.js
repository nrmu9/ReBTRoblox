"use strict"

// Local eval bridge for the BTRoblox DEV build. No dependencies.

const http = require("node:http")

const HOST = "127.0.0.1"
const PORT = Number(process.env.BTR_BRIDGE_PORT) || 8787

const JOB_TIMEOUT = 30000
const POLL_TIMEOUT = 25000
const LOG_LIMIT = 1000

const jobs = []
const waiters = []
const pending = new Map()
const logs = []

let nextId = 1
let lastSeen = 0

const connected = () => lastSeen !== 0 && Date.now() - lastSeen < POLL_TIMEOUT + 10000

const reply = (res, code, data) => {
	const body = JSON.stringify(data)

	res.writeHead(code, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
		"access-control-allow-origin": "*"
	})

	res.end(body)
}

const readBody = req => new Promise(resolve => {
	let body = ""

	req.setEncoding("utf8")
	req.on("data", chunk => { body += chunk })
	req.on("end", () => resolve(body))
	req.on("error", () => resolve(""))
})

const drop = waiter => {
	const index = waiters.indexOf(waiter)

	if(index !== -1) {
		waiters.splice(index, 1)
		clearTimeout(waiter.timer)
	}
}

const dispatch = () => {
	while(jobs.length && waiters.length) {
		const waiter = waiters.shift()
		clearTimeout(waiter.timer)
		reply(waiter.res, 200, jobs.shift())
	}
}

const routes = {
	"GET /poll"(req, res) {
		lastSeen = Date.now()

		if(jobs.length) { return reply(res, 200, jobs.shift()) }

		const waiter = { res }

		waiter.timer = setTimeout(() => {
			drop(waiter)
			reply(res, 200, { idle: true })
		}, POLL_TIMEOUT)

		res.on("close", () => drop(waiter))
		waiters.push(waiter)
	},

	"POST /eval"(req, res, url, body) {
		const id = nextId++

		const timer = setTimeout(() => {
			pending.delete(id)

			const index = jobs.findIndex(job => job.id === id)
			if(index !== -1) { jobs.splice(index, 1) }

			reply(res, 504, { ok: false, error: connected() ? "timed out" : "extension not connected" })
		}, JOB_TIMEOUT)

		pending.set(id, { res, timer })
		jobs.push({ id, target: url.searchParams.get("target") || "tab", code: body })
		dispatch()
	},

	"POST /result"(req, res, url, body) {
		lastSeen = Date.now()

		let msg

		try { msg = JSON.parse(body) }
		catch(err) { return reply(res, 400, { error: "bad json" }) }

		const entry = pending.get(msg.id)

		if(entry) {
			pending.delete(msg.id)
			clearTimeout(entry.timer)
			reply(entry.res, 200, msg)
		}

		reply(res, 200, { ok: true })
	},

	"POST /log"(req, res, url, body) {
		lastSeen = Date.now()

		try {
			const entry = JSON.parse(body)
			entry.at = new Date().toTimeString().slice(0, 8)

			logs.push(entry)
			while(logs.length > LOG_LIMIT) { logs.shift() }
		} catch(err) { /* ignore malformed */ }

		reply(res, 200, { ok: true })
	},

	"GET /logs"(req, res, url) {
		const level = url.searchParams.get("level")
		const match = url.searchParams.get("match")
		const count = Number(url.searchParams.get("n")) || 50

		let out = logs

		if(level) { out = out.filter(entry => entry.level === level) }
		if(match) { out = out.filter(entry => JSON.stringify(entry).includes(match)) }

		out = out.slice(-count)

		if(url.searchParams.get("clear")) { logs.length = 0 }

		reply(res, 200, out)
	},

	"GET /status"(req, res) {
		reply(res, 200, { connected: connected(), queued: jobs.length, logs: logs.length })
	}
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://${HOST}:${PORT}`)

	if(req.method === "OPTIONS") {
		res.writeHead(204, {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, POST, OPTIONS",
			"access-control-allow-headers": "content-type",
			"access-control-max-age": "86400"
		})

		return res.end()
	}

	const route = routes[`${req.method} ${url.pathname}`]

	if(!route) { return reply(res, 404, { error: "unknown route", routes: Object.keys(routes) }) }

	const body = req.method === "POST" ? await readBody(req) : ""

	try { route(req, res, url, body) }
	catch(err) {
		if(!res.headersSent) { reply(res, 500, { error: String(err && err.stack || err) }) }
	}
})

server.listen(PORT, HOST, () => console.log(`btr bridge on http://${HOST}:${PORT}`))
