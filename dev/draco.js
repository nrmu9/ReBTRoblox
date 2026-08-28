"use strict"

// Checks the draco decoder against Google's own, which is the only way to know
// it is right: a bitstream that decodes without complaint can still be decoding
// nonsense, and did. Two octahedral normal bugs survived for exactly that
// reason, both invisible until the output was compared against a reference.
//
//   node dev/draco.js            check the decoder against draco3d
//   node dev/draco.js --keep     leave the generated bitstreams in artifacts/
//
// draco3d is a devDependency and is not shipped.

const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "artifacts", ".draco")

// A sphere gives every case that matters: shared vertices, a seam where the uv
// wraps, and poles where many faces meet one vertex.
const sphere = (rings, sectors) => {
	const pos = []
	const nrm = []
	const uv = []
	const idx = []

	for (let r = 0; r <= rings; r++) {
		for (let s = 0; s <= sectors; s++) {
			const phi = (Math.PI * r) / rings
			const theta = (2 * Math.PI * s) / sectors
			const x = Math.sin(phi) * Math.cos(theta)
			const y = Math.cos(phi)
			const z = Math.sin(phi) * Math.sin(theta)

			pos.push(x, y, z)
			nrm.push(x, y, z)
			uv.push(s / sectors, r / rings)
		}
	}

	for (let r = 0; r < rings; r++) {
		for (let s = 0; s < sectors; s++) {
			const a = r * (sectors + 1) + s
			const b = a + sectors + 1
			idx.push(a, b, a + 1, b, b + 1, a + 1)
		}
	}

	return { pos, nrm, uv, idx }
}

const CASES = [
	{ name: "sphere-small", mesh: () => sphere(6, 8), quantization: 14 },
	{ name: "sphere-big", mesh: () => sphere(24, 32), quantization: 14 },
	{ name: "sphere-coarse", mesh: () => sphere(12, 16), quantization: 8 },
]

const encode = async (draco) => {
	const encoderModule = require("draco3d/draco_encoder_nodejs.js")
	const enc = await encoderModule()
	const written = []

	for (const testCase of CASES) {
		const m = testCase.mesh()
		const encoder = new enc.Encoder()
		const builder = new enc.MeshBuilder()
		const mesh = new enc.Mesh()
		const numPoints = m.pos.length / 3

		builder.AddFacesToMesh(mesh, m.idx.length / 3, new Uint32Array(m.idx))
		builder.AddFloatAttributeToMesh(mesh, enc.POSITION, numPoints, 3, new Float32Array(m.pos))
		builder.AddFloatAttributeToMesh(mesh, enc.NORMAL, numPoints, 3, new Float32Array(m.nrm))
		builder.AddFloatAttributeToMesh(mesh, enc.TEX_COORD, numPoints, 2, new Float32Array(m.uv))

		// Sequential is what roblox emits, and the only method we decode.
		encoder.SetSpeedOptions(10, 10)
		encoder.SetEncodingMethod(enc.MESH_SEQUENTIAL_ENCODING)
		encoder.SetAttributeQuantization(enc.POSITION, testCase.quantization)
		encoder.SetAttributeQuantization(enc.NORMAL, 10)
		encoder.SetAttributeQuantization(enc.TEX_COORD, 12)

		const buffer = new enc.DracoInt8Array()
		const length = encoder.EncodeMeshToDracoBuffer(mesh, buffer)

		if (length <= 0) {
			throw new Error(`failed to encode ${testCase.name}`)
		}

		const bytes = Buffer.alloc(length)
		for (let i = 0; i < length; i++) {
			bytes[i] = buffer.GetValue(i) & 0xff
		}

		fs.writeFileSync(path.join(draco, `${testCase.name}.drc`), bytes)
		written.push(testCase.name)

		for (const obj of [buffer, mesh, builder, encoder]) {
			enc.destroy(obj)
		}
	}

	return written
}

const reference = async (draco, name) => {
	const decoderModule = require("draco3d/draco_decoder_nodejs.js")
	const dec = await decoderModule()
	const bytes = fs.readFileSync(path.join(draco, `${name}.drc`))

	const buffer = new dec.DecoderBuffer()
	buffer.Init(new Int8Array(bytes), bytes.length)

	const decoder = new dec.Decoder()
	const mesh = new dec.Mesh()
	const status = decoder.DecodeBufferToMesh(buffer, mesh)

	if (!status.ok()) {
		throw new Error(`reference decode failed for ${name}: ${status.error_msg()}`)
	}

	const out = { numFaces: mesh.num_faces(), numPoints: mesh.num_points(), attributes: {} }

	for (const [attrName, type] of [
		["POSITION", dec.POSITION],
		["NORMAL", dec.NORMAL],
		["TEX_COORD", dec.TEX_COORD],
	]) {
		const id = decoder.GetAttributeId(mesh, type)
		if (id < 0) {
			continue
		}

		const attribute = decoder.GetAttribute(mesh, id)
		const values = new dec.DracoFloat32Array()
		decoder.GetAttributeFloatForAllPoints(mesh, attribute, values)

		const list = []
		for (let i = 0; i < values.size(); i++) {
			list.push(values.GetValue(i))
		}

		out.attributes[attrName] = { uniqueId: attribute.unique_id(), values: list }
		dec.destroy(values)
	}

	for (const obj of [mesh, decoder, buffer]) {
		dec.destroy(obj)
	}

	return out
}

// The decoder is bundled for node rather than imported: it reaches the
// extension environment through its imports and will not load without one.
const buildDecoder = (draco) => {
	const entry = path.join(draco, "entry.ts")
	const bundle = path.join(draco, "decoder.cjs")

	fs.writeFileSync(
		entry,
		`export { DracoBitstream } from "@/rbx/Parser/DracoBitstream"\n` +
			`export { ByteReader } from "@/rbx/Parser/ByteReader"\n`,
	)

	execFileSync(
		process.execPath,
		[
			path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
			entry,
			"--bundle",
			"--format=cjs",
			"--platform=node",
			`--alias:@=${path.join(ROOT, "src")}`,
			`--outfile=${bundle}`,
			"--log-level=error",
		],
		{ cwd: ROOT },
	)

	const stub = `
const __noop = new Proxy(function () {}, { get: () => __noop, apply: () => __noop, construct: () => __noop })
globalThis.chrome = { runtime: { getManifest: () => ({ short_name: "x", manifest_version: 2 }), getURL: (u) => u, onMessage: __noop, connect: __noop, sendMessage: __noop }, storage: { local: __noop, onChanged: __noop } }
globalThis.self = globalThis
globalThis.window = globalThis
globalThis.location = { href: "https://www.roblox.com/", host: "www.roblox.com", protocol: "https:" }
globalThis.document = { documentElement: { getAttribute: () => null, setAttribute() {} }, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }), querySelector: () => null }
globalThis.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} }
`

	fs.writeFileSync(bundle, stub + fs.readFileSync(bundle, "utf8"))

	return require(bundle)
}

const run = async () => {
	const keep = process.argv.includes("--keep")
	const draco = keep ? OUT : fs.mkdtempSync(path.join(os.tmpdir(), "btr-draco-"))

	fs.mkdirSync(draco, { recursive: true })

	const names = await encode(draco)
	const { DracoBitstream, ByteReader } = buildDecoder(draco)

	let failed = 0

	for (const name of names) {
		const expected = await reference(draco, name)
		const bytes = fs.readFileSync(path.join(draco, `${name}.drc`))

		let got
		try {
			got = DracoBitstream.parse(new ByteReader(new Uint8Array(bytes)))
		} catch (err) {
			console.log(`${name.padEnd(16)} threw: ${(err && err.message) || err}`)
			failed++
			continue
		}

		const problems = []

		if (got.faces.length / 3 !== expected.numFaces) {
			problems.push(`faces ${got.faces.length / 3}, expected ${expected.numFaces}`)
		}

		const byId = {}
		for (const attribute of got.attributes) {
			byId[attribute.uniqueId] = attribute
		}

		for (const [attrName, want] of Object.entries(expected.attributes)) {
			const attribute = byId[want.uniqueId]

			if (!attribute) {
				problems.push(`${attrName} missing`)
				continue
			}
			if (attribute.output.length !== want.values.length) {
				problems.push(
					`${attrName} has ${attribute.output.length} values, expected ${want.values.length}`,
				)
				continue
			}

			let worst = 0
			for (let i = 0; i < want.values.length; i++) {
				worst = Math.max(worst, Math.abs(attribute.output[i] - want.values[i]))
			}

			// Both sides dequantize the same way, so anything past rounding is a
			// decode that disagrees with the reference.
			if (worst > 1e-4) {
				problems.push(`${attrName} differs by up to ${worst.toFixed(5)}`)
			}
		}

		if (problems.length) {
			console.log(`${name.padEnd(16)} FAIL  ${problems.join(" | ")}`)
			failed++
		} else {
			console.log(`${name.padEnd(16)} ok`)
		}
	}

	if (!keep) {
		fs.rmSync(draco, { recursive: true, force: true })
	}

	console.log(`\n${names.length - failed} passing, ${failed} failing`)

	if (failed) {
		process.exit(1)
	}
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
