"use strict"

// Builds each target and zips dist/ into artifacts/. Pass --target=chrome to
// package one of them on its own.
//
// The zip is written here rather than shelled out to, because the only zip on
// a windows box is not the one on a linux runner, and a release should not
// depend on which. Entries are stored in sorted order with a fixed timestamp,
// so the same tree always produces a byte identical archive.

const { fork } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const zlib = require("node:zlib")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "artifacts")

// Built here rather than in dist/, so packaging never replaces the build the
// developer has loaded in their browser. Both targets share an output
// directory, so whichever ran last used to win, and packaging always ended on
// chrome: loading dist/ in firefox afterwards failed on background.service_worker.
const STAGE = "artifacts/.build"

// Firefox wants the .xpi extension; a chrome upload is a plain zip. Both are
// the same container.
const EXTENSIONS = { firefox: "xpi", chrome: "zip" }

// 1980-01-01 00:00:00, the earliest a dos timestamp can express.
const DOS_DATE = 0x21
const DOS_TIME = 0

const build = (target, out) =>
	new Promise((resolve, reject) => {
		const child = fork(path.join(__dirname, "build.js"), [`--target=${target}`, `--out=${out}`], {
			stdio: "inherit",
		})

		child.on("exit", (code) => {
			if (code) {
				reject(new Error(`build failed for ${target}`))
			} else {
				resolve()
			}
		})
	})

/** Every file under dir, sorted, named relative to it with forward slashes. */
const collect = (dir, prefix = "") => {
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.toSorted((a, b) => (a.name < b.name ? -1 : 1))
	const files = []

	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		const name = prefix + entry.name

		if (entry.isDirectory()) {
			files.push(...collect(full, `${name}/`))
		} else if (entry.isFile()) {
			files.push({ name: name, data: fs.readFileSync(full) })
		}
	}

	return files
}

const zip = (files) => {
	const body = []
	const central = []
	let offset = 0

	for (const file of files) {
		const name = Buffer.from(file.name, "utf8")
		const crc = zlib.crc32(file.data)
		const deflated = zlib.deflateRawSync(file.data, { level: 9 })

		// Already compressed assets come out bigger deflated, so store those.
		const stored = deflated.length >= file.data.length
		const data = stored ? file.data : deflated
		const method = stored ? 0 : 8

		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0x800, 6) // names are utf-8
		local.writeUInt16LE(method, 8)
		local.writeUInt16LE(DOS_TIME, 10)
		local.writeUInt16LE(DOS_DATE, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(file.data.length, 22)
		local.writeUInt16LE(name.length, 26)
		local.writeUInt16LE(0, 28)

		body.push(local, name, data)

		const entry = Buffer.alloc(46)
		entry.writeUInt32LE(0x02014b50, 0)
		entry.writeUInt16LE(20, 4)
		entry.writeUInt16LE(20, 6)
		entry.writeUInt16LE(0x800, 8)
		entry.writeUInt16LE(method, 10)
		entry.writeUInt16LE(DOS_TIME, 12)
		entry.writeUInt16LE(DOS_DATE, 14)
		entry.writeUInt32LE(crc, 16)
		entry.writeUInt32LE(data.length, 20)
		entry.writeUInt32LE(file.data.length, 24)
		entry.writeUInt16LE(name.length, 28)
		entry.writeUInt32LE(0, 30) // extra and comment lengths
		entry.writeUInt32LE(0, 34) // disk number and internal attributes
		entry.writeUInt32LE(0, 38) // external attributes
		entry.writeUInt32LE(offset, 42)

		central.push(entry, name)
		offset += local.length + name.length + data.length
	}

	const directory = Buffer.concat(central)

	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(0, 4)
	end.writeUInt16LE(0, 6)
	end.writeUInt16LE(files.length, 8)
	end.writeUInt16LE(files.length, 10)
	end.writeUInt32LE(directory.length, 12)
	end.writeUInt32LE(offset, 16)
	end.writeUInt16LE(0, 20)

	return Buffer.concat([...body, directory, end])
}

const run = async () => {
	const args = process.argv.slice(2)
	const only = (args.find((arg) => arg.startsWith("--target=")) || "").split("=")[1]
	const targets = only ? [only] : Object.keys(EXTENSIONS)

	const { name: pkgName, version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))

	for (const target of targets) {
		if (!EXTENSIONS[target]) {
			throw new Error(`unknown target ${target}`)
		}
	}

	fs.rmSync(OUT, { recursive: true, force: true })
	fs.mkdirSync(OUT, { recursive: true })

	const written = []

	for (const target of targets) {
		await build(target, STAGE)

		const name = `${pkgName}-${version}-${target}.${EXTENSIONS[target]}`
		const archive = zip(collect(path.join(ROOT, STAGE)))

		fs.writeFileSync(path.join(OUT, name), archive)
		written.push(name)

		console.log(`packaged artifacts/${name} (${(archive.length / 1024).toFixed(0)} kb)`)
	}

	// Same format as sha256sum, so `sha256sum -c SHA256SUMS` verifies a download.
	const sums = written
		.map((name) => {
			const digest = require("node:crypto")
				.createHash("sha256")
				.update(fs.readFileSync(path.join(OUT, name)))
				.digest("hex")

			return `${digest}  ${name}`
		})
		.join("\n")

	fs.writeFileSync(path.join(OUT, "SHA256SUMS"), sums + "\n")

	fs.rmSync(path.join(ROOT, STAGE), { recursive: true, force: true })
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
