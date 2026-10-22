import { test } from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { evaluate, shapePoint, squashed, type EmitterSource } from "@/rbx/Avatar/Effects"

const close = (actual: number, expected: number, message?: string) =>
	assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} ${actual} is not ${expected}`)

test("a sequence is interpolated between its points", () => {
	const sequence = [
		{ Time: 0, Value: 0 },
		{ Time: 0.5, Value: 10 },
		{ Time: 1, Value: 0 },
	]

	close(evaluate(sequence, 0, 0), 0)
	close(evaluate(sequence, 0.25, 0), 5)
	close(evaluate(sequence, 0.5, 0), 10)
	close(evaluate(sequence, 0.75, 0), 5)
	close(evaluate(sequence, 1, 0), 0)
})

test("an envelope widens a value by up to its size, either way", () => {
	const sequence = [
		{ Time: 0, Value: 2, Envelope: 1 },
		{ Time: 1, Value: 2, Envelope: 1 },
	]

	close(evaluate(sequence, 0.5, 1), 3)
	close(evaluate(sequence, 0.5, -1), 1)
	close(evaluate(sequence, 0.5, 0), 2)
})

test("squash narrows and lengthens, or widens and shortens, keeping the area", () => {
	assert.deepEqual(squashed(0), [1, 1])
	close(squashed(1)[0], 0.5, "width")
	close(squashed(1)[1], 2, "height")
	close(squashed(-1)[0], 2, "width")
	close(squashed(-1)[1], 0.5, "height")

	for (const amount of [-3, -0.5, 0.5, 3]) {
		const [width, height] = squashed(amount)
		close(width * height, 1, `area at ${amount}`)
	}
})

const source = (over: Partial<EmitterSource>) =>
	({
		direction: new THREE.Vector3(0, 1, 0),
		shape: 0,
		surface: false,
		inOut: 0,
		partial: 1,
		...over,
	}) as EmitterSource

const box: [number, number, number] = [4, 2, 6]

test("a sphere's surface points sit on the part's ellipsoid", () => {
	const point = new THREE.Vector3()
	const out = new THREE.Vector3()

	for (let i = 0; i < 200; i++) {
		shapePoint(source({ shape: 1, surface: true }), box, point, out)
		close((point.x / 2) ** 2 + (point.y / 1) ** 2 + (point.z / 3) ** 2, 1, "on the surface")
		close(out.length(), 1, "the way out is a direction")
	}
})

test("a sphere's cap keeps to the emission side", () => {
	const point = new THREE.Vector3()
	const out = new THREE.Vector3()

	for (let i = 0; i < 200; i++) {
		shapePoint(source({ shape: 1, surface: true, partial: 0.5 }), box, point, out)
		assert.ok(out.y >= -1e-9, "half a sphere, on the emission side")
	}
})

test("a disc with partial opens a hole in its middle", () => {
	const point = new THREE.Vector3()
	const out = new THREE.Vector3()

	for (let i = 0; i < 200; i++) {
		shapePoint(source({ shape: 3, partial: 0.5 }), box, point, out)
		const reach = Math.hypot(point.x / 2, point.z / 3)
		assert.ok(reach >= 0.5 - 1e-9 && reach <= 1 + 1e-9, `${reach} is outside the ring`)
		close(point.y, 0, "flat across the axis")
		assert.deepEqual(out.toArray(), [0, 1, 0])
	}
})

test("a box's points stay inside the part", () => {
	const point = new THREE.Vector3()
	const out = new THREE.Vector3()

	for (let i = 0; i < 200; i++) {
		shapePoint(source({}), box, point, out)
		assert.ok(Math.abs(point.x) <= 2 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 3)
	}
})
