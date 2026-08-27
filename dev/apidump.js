"use strict"

// Regenerates src/rbx/ApiDump.data.json from Roblox's published data.
//
// Two sources are needed. The API dump gives classes, properties and enums.
// Explorer ordering and icons are not in it; they live in ReflectionMetadata.xml
// inside the Studio package, which is pulled out with ranged reads rather than
// by downloading the whole 125MB archive.
//
//   node dev/apidump.js            rewrite the data file
//   node dev/apidump.js --dry      report what would change

const fs = require("node:fs")
const path = require("node:path")
const zlib = require("node:zlib")

const VERSION_URL = "https://clientsettingscdn.roblox.com/v2/client-version/WindowsStudio64"
const SETUP = "https://setup.rbxcdn.com/"
const OUT = path.join(__dirname, "..", "src", "rbx", "ApiDump.data.json")
const ICONS_OUT = path.join(__dirname, "..", "res", "class_images.png")

// ClassImages.PNG has moved between texture packages before, so they are tried
// in turn rather than hardcoding one.
const ICON_PACKAGES = [
	"content-textures2.zip",
	"content-textures3.zip",
	"studiocontent-textures.zip",
	"extracontent-textures.zip",
]

const dryRun = process.argv.includes("--dry")

const log = (...args) => console.log(...args)

// ------------------------------------------------------------- zip over http

const fetchRange = async (url, start, end) => {
	const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })

	if (res.status !== 206) {
		throw new Error(`expected a partial response, got ${res.status}`)
	}

	return Buffer.from(await res.arrayBuffer())
}

/** Reads one file out of a remote zip without downloading the rest of it. */
const readZipEntry = async (url, wanted) => {
	const head = await fetch(url, { method: "HEAD" })
	const size = Number(head.headers.get("content-length"))

	if (!size) {
		throw new Error("could not determine archive size")
	}

	// The end of central directory record lives in the last 64KB at most.
	const tailLength = Math.min(65557, size)
	const tail = await fetchRange(url, size - tailLength, size - 1)

	const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
	if (eocd === -1) {
		throw new Error("no end of central directory record")
	}

	const centralSize = tail.readUInt32LE(eocd + 12)
	const centralOffset = tail.readUInt32LE(eocd + 16)

	const central = await fetchRange(url, centralOffset, centralOffset + centralSize - 1)

	let cursor = 0
	while (cursor + 46 <= central.length) {
		if (central.readUInt32LE(cursor) !== 0x02014b50) {
			break
		}

		const method = central.readUInt16LE(cursor + 10)
		const compressedSize = central.readUInt32LE(cursor + 20)
		const nameLength = central.readUInt16LE(cursor + 28)
		const extraLength = central.readUInt16LE(cursor + 30)
		const commentLength = central.readUInt16LE(cursor + 32)
		const localOffset = central.readUInt32LE(cursor + 42)
		const name = central.toString("utf8", cursor + 46, cursor + 46 + nameLength)

		if (name === wanted || name.endsWith("/" + wanted)) {
			// The local header repeats the name and extra fields, and its extra
			// length can differ from the central one, so it has to be read.
			const local = await fetchRange(url, localOffset, localOffset + 29)
			const localNameLength = local.readUInt16LE(26)
			const localExtraLength = local.readUInt16LE(28)
			const dataStart = localOffset + 30 + localNameLength + localExtraLength

			const raw = await fetchRange(url, dataStart, dataStart + compressedSize - 1)
			return method === 0 ? raw : zlib.inflateRawSync(raw)
		}

		cursor += 46 + nameLength + extraLength + commentLength
	}

	throw new Error(`${wanted} is not in the archive`)
}

// ------------------------------------------------------- reflection metadata

/** ExplorerOrder and ExplorerImageIndex per class name. */
const parseReflectionMetadata = (xml) => {
	const out = {}

	// Each class is an Item whose Properties carry Name plus the explorer fields.
	const itemRe = /<Item class="ReflectionMetadataClass"[\s\S]*?<Properties>([\s\S]*?)<\/Properties>/g
	let match

	while ((match = itemRe.exec(xml))) {
		const props = match[1]

		// Roblox writes all of these as <string>, the numeric ones included, so
		// the tag name cannot be used to pick them out.
		const read = (key) => {
			const m = new RegExp(`<[a-z]+ name="${key}">([\\s\\S]*?)</[a-z]+>`).exec(props)
			return m ? m[1].trim() : undefined
		}

		const name = read("Name")
		if (!name) {
			continue
		}

		const order = read("ExplorerOrder")
		const icon = read("ExplorerImageIndex")

		// Counting a class that carries neither would mask a parse failure as
		// "metadata found", which is exactly how the string/int mismatch slipped by.
		if (order === undefined && icon === undefined) {
			continue
		}

		out[name] = {
			order: order === undefined ? undefined : Number(order),
			icon: icon === undefined ? undefined : Number(icon),
		}
	}

	return out
}

// --------------------------------------------------------------------- build

const build = (dump, metadata, previous) => {
	const categories = []
	const categoryIndex = (name) => {
		let index = categories.indexOf(name)
		if (index === -1) {
			index = categories.push(name) - 1
		}
		return index
	}

	const enums = dump.Enums.map((e) => [e.Name, e.Items.sort((a, b) => a.Value - b.Value).map((i) => i.Name)])
	const enumIndex = {}
	enums.forEach(([name], i) => (enumIndex[name] = i))

	// Superclasses have to be emitted before their subclasses, because the
	// decoder resolves a parent by looking it up as it goes.
	const byName = {}
	for (const cls of dump.Classes) {
		byName[cls.Name] = cls
	}

	const ordered = []
	const seen = new Set()

	const visit = (cls) => {
		if (!cls || seen.has(cls.Name)) {
			return
		}
		seen.add(cls.Name)
		const parent = byName[cls.Superclass]
		if (parent) {
			visit(parent)
		}
		ordered.push(cls)
	}

	// Object first: index 0 is the implicit parent in the encoding.
	visit(byName.Object)
	for (const cls of dump.Classes) {
		visit(cls)
	}

	const classIndex = {}
	ordered.forEach((cls, i) => (classIndex[cls.Name] = i))

	const previousMembers = {}
	for (const entry of previous?.Classes ?? []) {
		const hasSuper = typeof entry[1] === "number"
		const members = hasSuper ? entry[2] : entry[1] instanceof Object && !Array.isArray(entry[1]) ? entry[1] : null
		if (members) {
			previousMembers[entry[0]] = { members, categories: previous.Categories, enums: previous.Enums }
		}
	}

	let carried = 0

	const classes = ordered.map((cls) => {
		const members = {}

		for (const member of cls.Members ?? []) {
			if (member.MemberType !== "Property") {
				continue
			}

			const group = categoryIndex(member.Category || "Data")

			if (member.ValueType?.Category === "Enum" && enumIndex[member.ValueType.Name] !== undefined) {
				members[member.Name] = [group, enumIndex[member.ValueType.Name]]
			} else {
				members[member.Name] = group
			}
		}

		// Older dumps carried lowercase aliases such as size and shap, which old
		// rbxm files still use. Current dumps dropped them, so they are carried
		// over rather than lost.
		const old = previousMembers[cls.Name]
		if (old) {
			for (const [name, value] of Object.entries(old.members)) {
				if (name in members) {
					continue
				}

				const oldGroup = typeof value === "number" ? value : value[0]
				const groupName = oldGroup === -1 ? null : old.categories[oldGroup]
				const group = groupName === null ? -1 : categoryIndex(groupName)

				if (Array.isArray(value)) {
					const enumName = old.enums[value[1] || 0]?.[0]
					members[name] = enumIndex[enumName] === undefined ? group : [group, enumIndex[enumName]]
				} else {
					members[name] = group
				}

				carried++
			}
		}

		const meta = metadata[cls.Name]
		const rmd =
			meta?.icon !== undefined
				? [meta.order ?? 0, meta.icon]
				: meta?.order !== undefined
					? meta.order
					: undefined

		const superIndex = classIndex[cls.Superclass]
		const entry = [cls.Name, superIndex === undefined ? 0 : superIndex]
		const hasMembers = Object.keys(members).length > 0

		if (hasMembers || rmd !== undefined) {
			entry.push(hasMembers ? members : 0)
		}
		if (rmd !== undefined) {
			entry.push(rmd)
		}

		return entry
	})

	return { data: { Categories: categories, Enums: enums, Classes: classes }, carried }
}

// ---------------------------------------------------------------------- main

const main = async () => {
	log("resolving the current Studio version")
	const version = await (await fetch(VERSION_URL)).json()
	const upload = version.clientVersionUpload
	log(`  ${version.version}  (${upload})`)

	log("downloading the api dump")
	const dump = await (await fetch(`${SETUP}${upload}-API-Dump.json`)).json()
	log(`  ${dump.Classes.length} classes, ${dump.Enums.length} enums`)

	log("extracting ReflectionMetadata.xml from the studio package")
	let metadata = {}
	try {
		const xml = await readZipEntry(`${SETUP}${upload}-RobloxStudio.zip`, "ReflectionMetadata.xml")
		metadata = parseReflectionMetadata(xml.toString("utf8"))
		log(`  ${Object.keys(metadata).length} classes carry explorer metadata`)
	} catch (err) {
		log(`  could not read it (${err.message}); explorer order and icons will be kept from the existing file`)
	}

	const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null

	// Nothing usable came back, so keep whatever the current file knows.
	if (!Object.keys(metadata).length && previous) {
		for (const entry of previous.Classes) {
			const hasSuper = typeof entry[1] === "number"
			const rmd = hasSuper ? entry[3] : entry[2]
			if (rmd === undefined) {
				continue
			}
			metadata[entry[0]] = Array.isArray(rmd) ? { order: rmd[0], icon: rmd[1] } : { order: rmd }
		}
	}

	const { data, carried } = build(dump, metadata, previous)

	const before = previous ? previous.Classes.map((c) => c[0]) : []
	const after = data.Classes.map((c) => c[0])
	const added = after.filter((n) => !before.includes(n))
	const removed = before.filter((n) => !after.includes(n))

	log("")
	log(`classes    ${before.length} -> ${after.length}   (+${added.length} / -${removed.length})`)
	log(`enums      ${previous?.Enums.length ?? 0} -> ${data.Enums.length}`)
	log(`categories ${previous?.Categories.length ?? 0} -> ${data.Categories.length}`)
	log(`legacy member aliases carried over: ${carried}`)

	if (added.length) {
		log(`added: ${added.slice(0, 12).join(", ")}${added.length > 12 ? ", ..." : ""}`)
	}
	if (removed.length) {
		log(`removed: ${removed.slice(0, 12).join(", ")}${removed.length > 12 ? ", ..." : ""}`)
	}

	// The explorer icon sheet is a 16px strip indexed by ExplorerImageIndex, so
	// it has to come from the same deploy as the metadata above.
	log("")
	log("looking for the explorer icon sheet")

	let icons = null
	for (const pkg of ICON_PACKAGES) {
		try {
			icons = await readZipEntry(`${SETUP}${upload}-${pkg}`, "ClassImages.PNG")
			log(`  found in ${pkg}`)
			break
		} catch {
			/* try the next package */
		}
	}

	if (!icons) {
		log("  not found; leaving the existing sheet alone")
	} else {
		const width = icons.readUInt32BE(16)
		const height = icons.readUInt32BE(20)
		const tiles = Math.floor(width / height)
		const maxIcon = Math.max(
			-1,
			...data.Classes.map((c) => (Array.isArray(c[3]) ? c[3][1] : Array.isArray(c[2]) ? c[2][1] : -1))
		)

		log(`  ${width}x${height}, ${tiles} tiles; highest index in use is ${maxIcon}`)

		if (maxIcon >= tiles) {
			log(`  refusing to use it: ${maxIcon} would fall outside the sheet`)
			icons = null
		}
	}

	if (dryRun) {
		log("\ndry run, nothing written")
		return
	}

	fs.writeFileSync(OUT, JSON.stringify(data, null, "\t") + "\n")
	log(`\nwrote ${path.relative(path.join(__dirname, ".."), OUT)}`)

	if (icons) {
		// Kept as png rather than re-encoded: canvas only produces lossy webp,
		// which smears 16px icons, and the size difference is a few kilobytes.
		fs.writeFileSync(ICONS_OUT, icons)
		log(`wrote ${path.relative(path.join(__dirname, ".."), ICONS_OUT)}`)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
