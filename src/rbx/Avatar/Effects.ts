import * as THREE from "three"
import { AssetCache } from "@/rbx/AssetCache"

// An accessory's particles and lights. They are read from its Handle and the
// attachments in it, and drawn on top of the avatar: particles simulated here
// each frame and drawn as textured points, lights as three's own. Fire,
// Sparkles and Smoke, the older effects, become emitters shaped like them.

type Sequence = Array<{ Time: number; Value: number; Envelope?: number }>
type ColorSequence = Array<{ Time: number; Value: [number, number, number] }>
type Range = [number, number]

interface EmitterSource {
	kind: "particles"
	/** Where it sits in the Handle's space. */
	local: THREE.Matrix4
	/** The Handle's size, for one emitting from the part rather than a point. */
	box: [number, number, number] | null
	rate: number
	lifetime: Range
	speed: Range
	spread: [number, number]
	direction: THREE.Vector3
	acceleration: THREE.Vector3
	drag: number
	size: Sequence
	transparency: Sequence
	color: ColorSequence
	rotation: Range
	rotSpeed: Range
	texture: string | null
	additive: boolean
	brightness: number
	locked: boolean
	timeScale: number
	/** Cells per side of a flipbook texture, 1 for none. */
	grid: number
	flipbookFps: Range
	flipbookStartRandom: boolean
}

interface LightSource {
	kind: "light"
	type: "point" | "spot"
	local: THREE.Matrix4
	color: THREE.Color
	brightness: number
	range: number
	angle: number
	direction: THREE.Vector3
}

export type EffectSource = EmitterSource | LightSource

// Roblox's NormalId: Right, Top, Back, Left, Bottom, Front.
const NORMALS = [
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(0, 0, 1),
	new THREE.Vector3(-1, 0, 0),
	new THREE.Vector3(0, -1, 0),
	new THREE.Vector3(0, 0, -1),
]

const range = (value: any, fallback: Range): Range =>
	Array.isArray(value) && value.length === 2 ? [+value[0], +value[1]] : fallback

const sequence = (value: any, fallback: number): Sequence =>
	Array.isArray(value) && value.length
		? value
		: [
				{ Time: 0, Value: fallback },
				{ Time: 1, Value: fallback },
			]

const color3 = (value: any, fallback: [number, number, number] = [1, 1, 1]): [number, number, number] =>
	Array.isArray(value) && value.length === 3 ? [+value[0], +value[1], +value[2]] : fallback

const flat = (rgb: [number, number, number]): ColorSequence => [
	{ Time: 0, Value: rgb },
	{ Time: 1, Value: rgb },
]

const cframe = (value: any) => {
	const matrix = new THREE.Matrix4()

	if (Array.isArray(value) && value.length === 12) {
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = value
		matrix.set(r00, r01, r02, x, r10, r11, r12, y, r20, r21, r22, z, 0, 0, 0, 1)
	}

	return matrix
}

const textureUrl = (value: unknown) =>
	typeof value === "string" && value && AssetCache.isValidAssetUrl(value) ? value : null

const fromInstance = (inst: any, local: THREE.Matrix4, box: EmitterSource["box"]): EffectSource | null => {
	if (inst.Enabled === false) {
		return null
	}

	switch (inst.ClassName) {
		case "ParticleEmitter":
			return {
				kind: "particles",
				local,
				box,
				rate: Math.min(+(inst.Rate ?? 20), 400),
				lifetime: range(inst.Lifetime, [5, 10]),
				speed: range(inst.Speed, [5, 5]),
				spread: [+(inst.SpreadAngle?.[0] ?? 0), +(inst.SpreadAngle?.[1] ?? 0)],
				direction: NORMALS[inst.EmissionDirection ?? 1]?.clone() ?? NORMALS[1].clone(),
				acceleration: new THREE.Vector3(...color3(inst.Acceleration, [0, 0, 0])),
				drag: +(inst.Drag ?? 0),
				size: sequence(inst.Size, 1),
				transparency: sequence(inst.Transparency, 0),
				color: Array.isArray(inst.Color) && inst.Color.length ? inst.Color : flat([1, 1, 1]),
				rotation: range(inst.Rotation, [0, 0]),
				rotSpeed: range(inst.RotSpeed, [0, 0]),
				texture: textureUrl(inst.Texture),
				additive: +(inst.LightEmission ?? 0) >= 0.5,
				brightness: +(inst.Brightness ?? 1),
				locked: !!inst.LockedToPart,
				timeScale: +(inst.TimeScale ?? 1),
				grid: [1, 2, 4, 8][inst.FlipbookLayout ?? 0] ?? 1,
				flipbookFps: range(inst.FlipbookFramerate, [1, 1]),
				flipbookStartRandom: !!inst.FlipbookStartRandom,
			}

		case "Fire": {
			const size = +(inst.Size ?? 5)
			const heat = +(inst.Heat ?? 9)
			return {
				kind: "particles",
				local,
				box: null,
				rate: 35,
				lifetime: [0.45, 0.8],
				speed: [heat * 0.3, heat * 0.45],
				spread: [10, 10],
				direction: NORMALS[1].clone(),
				acceleration: new THREE.Vector3(0, heat * 0.25, 0),
				drag: 1,
				size: [
					{ Time: 0, Value: size * 0.28 },
					{ Time: 1, Value: size * 0.06 },
				],
				transparency: [
					{ Time: 0, Value: 0.35 },
					{ Time: 0.5, Value: 0.6 },
					{ Time: 1, Value: 1 },
				],
				color: [
					{ Time: 0, Value: color3(inst.Color, [0.93, 0.6, 0.2]) },
					{ Time: 1, Value: color3(inst.SecondaryColor, [0.55, 0.1, 0.05]) },
				],
				rotation: [0, 360],
				rotSpeed: [-90, 90],
				texture: null,
				additive: true,
				brightness: 1,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
			}
		}

		case "Sparkles":
			return {
				kind: "particles",
				local,
				box: null,
				rate: 25,
				lifetime: [0.8, 1.4],
				speed: [2, 4],
				spread: [180, 180],
				direction: NORMALS[1].clone(),
				acceleration: new THREE.Vector3(0, -1, 0),
				drag: 0.5,
				size: [
					{ Time: 0, Value: 0.3 },
					{ Time: 1, Value: 0 },
				],
				transparency: [
					{ Time: 0, Value: 0 },
					{ Time: 1, Value: 0.5 },
				],
				color: flat(color3(inst.SparkleColor, [0.56, 0.31, 1])),
				rotation: [0, 360],
				rotSpeed: [0, 0],
				texture: null,
				additive: false,
				brightness: 1.5,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
			}

		case "Smoke": {
			const size = +(inst.Size ?? 1)
			const rise = +(inst.RiseVelocity ?? 1)
			const opacity = +(inst.Opacity ?? 0.5)
			return {
				kind: "particles",
				local,
				box: null,
				rate: 12,
				lifetime: [3, 5],
				speed: [rise * 0.8, rise],
				spread: [20, 20],
				direction: NORMALS[1].clone(),
				acceleration: new THREE.Vector3(0, 0, 0),
				drag: 0.2,
				size: [
					{ Time: 0, Value: size },
					{ Time: 1, Value: size * 2.5 },
				],
				transparency: [
					{ Time: 0, Value: 1 - opacity },
					{ Time: 1, Value: 1 },
				],
				color: flat(color3(inst.Color, [1, 1, 1])),
				rotation: [0, 360],
				rotSpeed: [-20, 20],
				texture: null,
				additive: false,
				brightness: 1,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
			}
		}

		case "PointLight":
		case "SpotLight":
		case "SurfaceLight":
			return {
				kind: "light",
				type: inst.ClassName === "PointLight" ? "point" : "spot",
				local,
				color: new THREE.Color(...color3(inst.Color)),
				brightness: +(inst.Brightness ?? 1),
				range: Math.min(+(inst.Range ?? (inst.ClassName === "PointLight" ? 8 : 16)), 60),
				angle: +(inst.Angle ?? 90),
				direction: NORMALS[inst.Face ?? 5]?.clone() ?? NORMALS[5].clone(),
			}

		default:
			return null
	}
}

/** The effects under a Handle and its attachments, each placed in the Handle's space. */
export const collectEffects = (handle: any): EffectSource[] => {
	const size = color3(handle.Size ?? handle.size, [1, 1, 1])
	const effects: EffectSource[] = []

	for (const child of handle.Children ?? []) {
		if (child.ClassName === "Attachment") {
			const local = cframe(child.CFrame)

			for (const inner of child.Children ?? []) {
				const effect = fromInstance(inner, local, null)
				if (effect) {
					effects.push(effect)
				}
			}
		} else {
			const effect = fromInstance(child, new THREE.Matrix4(), size)
			if (effect) {
				effects.push(effect)
			}
		}
	}

	return effects
}

const evaluate = (points: Sequence, t: number, envelope: number) => {
	for (let i = 1; i < points.length; i++) {
		const next = points[i]

		if (t <= next.Time) {
			const prev = points[i - 1]
			const span = next.Time - prev.Time || 1
			const k = (t - prev.Time) / span
			const value = prev.Value + (next.Value - prev.Value) * k
			const spread = (prev.Envelope ?? 0) + ((next.Envelope ?? 0) - (prev.Envelope ?? 0)) * k
			return value + spread * envelope
		}
	}

	const last = points.at(-1)!
	return last.Value + (last.Envelope ?? 0) * envelope
}

const evaluateColor = (points: ColorSequence, t: number, out: THREE.Color) => {
	for (let i = 1; i < points.length; i++) {
		const next = points[i]

		if (t <= next.Time) {
			const prev = points[i - 1]
			const k = (t - prev.Time) / (next.Time - prev.Time || 1)
			return out.setRGB(
				prev.Value[0] + (next.Value[0] - prev.Value[0]) * k,
				prev.Value[1] + (next.Value[1] - prev.Value[1]) * k,
				prev.Value[2] + (next.Value[2] - prev.Value[2]) * k,
			)
		}
	}

	return out.setRGB(...points.at(-1)!.Value)
}

const between = ([min, max]: Range) => min + Math.random() * (max - min)

/** A soft round dot, for emitters with no texture of their own and while one loads. */
let softDot: THREE.Texture | null = null

const defaultTexture = () => {
	if (!softDot) {
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 64
		const ctx = canvas.getContext("2d")!
		const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
		gradient.addColorStop(0, "rgba(255,255,255,1)")
		gradient.addColorStop(0.4, "rgba(255,255,255,0.6)")
		gradient.addColorStop(1, "rgba(255,255,255,0)")
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 64, 64)
		softDot = new THREE.CanvasTexture(canvas)
	}

	return softDot
}

const VERTEX = `
	attribute float pSize;
	attribute float pAlpha;
	attribute vec3 pColor;
	attribute float pRotation;
	attribute float pFrame;
	uniform float uScale;
	varying float vAlpha;
	varying vec3 vColor;
	varying float vRotation;
	varying float vFrame;

	void main() {
		vec4 view = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * view;
		// A rotated square needs room for its corners, hence the root of two.
		gl_PointSize = pSize * uScale * 1.4142 / max(0.001, -view.z);
		vAlpha = pAlpha;
		vColor = pColor;
		vRotation = pRotation;
		vFrame = pFrame;
	}
`

const FRAGMENT = `
	uniform sampler2D uMap;
	uniform float uGrid;
	varying float vAlpha;
	varying vec3 vColor;
	varying float vRotation;
	varying float vFrame;

	void main() {
		vec2 p = (vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5) * 1.4142;
		float c = cos(vRotation);
		float s = sin(vRotation);
		p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;

		if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
			discard;
		}

		float cell = floor(vFrame);
		vec2 uv = (vec2(mod(cell, uGrid), uGrid - 1.0 - floor(cell / uGrid)) + p) / uGrid;
		vec4 texel = texture2D(uMap, uv);
		float alpha = texel.a * vAlpha;

		if (alpha < 0.004) {
			discard;
		}

		gl_FragColor = vec4(texel.rgb * vColor, alpha);
	}
`

const tempMatrix = new THREE.Matrix4()
const tempVector = new THREE.Vector3()
const tempColor = new THREE.Color()
const tempQuat = new THREE.Quaternion()
const drawingSize = new THREE.Vector2()

class Emitter {
	readonly points: THREE.Points
	private readonly source: EmitterSource
	private readonly capacity: number
	private count = 0
	private carry = 0

	private readonly position: Float32Array
	private readonly velocity: Float32Array
	private readonly age: Float32Array
	private readonly life: Float32Array
	private readonly spin: Float32Array
	private readonly turn: Float32Array
	private readonly sizeEnvelope: Float32Array
	private readonly fadeEnvelope: Float32Array
	private readonly frameStart: Float32Array
	private readonly frameRate: Float32Array

	private readonly attributes: Record<string, THREE.BufferAttribute>

	constructor(source: EmitterSource) {
		this.source = source
		this.capacity = Math.max(8, Math.min(2000, Math.ceil(source.rate * source.lifetime[1] * 1.2) + 8))

		const n = this.capacity
		this.position = new Float32Array(n * 3)
		this.velocity = new Float32Array(n * 3)
		this.age = new Float32Array(n)
		this.life = new Float32Array(n)
		this.spin = new Float32Array(n)
		this.turn = new Float32Array(n)
		this.sizeEnvelope = new Float32Array(n)
		this.fadeEnvelope = new Float32Array(n)
		this.frameStart = new Float32Array(n)
		this.frameRate = new Float32Array(n)

		const geometry = new THREE.BufferGeometry()
		this.attributes = {
			position: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
			pSize: new THREE.BufferAttribute(new Float32Array(n), 1),
			pAlpha: new THREE.BufferAttribute(new Float32Array(n), 1),
			pColor: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
			pRotation: new THREE.BufferAttribute(new Float32Array(n), 1),
			pFrame: new THREE.BufferAttribute(new Float32Array(n), 1),
		}

		for (const [name, attribute] of Object.entries(this.attributes)) {
			attribute.setUsage(THREE.DynamicDrawUsage)
			geometry.setAttribute(name, attribute)
		}

		geometry.setDrawRange(0, 0)

		const material = new THREE.ShaderMaterial({
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			uniforms: {
				uMap: { value: defaultTexture() },
				uGrid: { value: 1 },
				uScale: { value: 1 },
			},
			transparent: true,
			depthWrite: false,
			blending: source.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
		})

		this.points = new THREE.Points(geometry, material)
		this.points.frustumCulled = false
		this.points.matrixAutoUpdate = false

		// Point sizes are in pixels, so they follow the canvas and the field of view.
		this.points.onBeforeRender = (renderer, _scene, camera) => {
			renderer.getDrawingBufferSize(drawingSize)
			const fov = (camera as THREE.PerspectiveCamera).fov ?? 60
			material.uniforms.uScale.value = drawingSize.y / (2 * Math.tan(((fov / 2) * Math.PI) / 180))
		}

		if (source.texture) {
			AssetCache.loadImage(true, source.texture, (img: HTMLImageElement | null) => {
				if (!img) {
					return
				}

				const texture = new THREE.Texture(img)
				texture.needsUpdate = true
				material.uniforms.uMap.value = texture
				material.uniforms.uGrid.value = source.grid
			})
		}
	}

	/** Spawns and moves particles. `world` is where the emitter is now, in the avatar's space. */
	update(dt: number, world: THREE.Matrix4, scale: number) {
		const source = this.source
		const step = dt * source.timeScale

		// Age and move the living, dropping the expired by moving the last into their place.
		const damp = Math.exp(-source.drag * step)

		for (let i = 0; i < this.count;) {
			this.age[i] += step

			if (this.age[i] >= this.life[i]) {
				this.remove(i)
				continue
			}

			const j = i * 3
			this.velocity[j] = (this.velocity[j] + source.acceleration.x * step) * damp
			this.velocity[j + 1] = (this.velocity[j + 1] + source.acceleration.y * step) * damp
			this.velocity[j + 2] = (this.velocity[j + 2] + source.acceleration.z * step) * damp
			this.position[j] += this.velocity[j] * step
			this.position[j + 1] += this.velocity[j + 1] * step
			this.position[j + 2] += this.velocity[j + 2] * step
			this.spin[i] += this.turn[i] * step
			i++
		}

		this.carry += source.rate * step

		while (this.carry >= 1) {
			this.carry -= 1

			if (this.count < this.capacity) {
				this.spawn(world, scale)
			}
		}

		this.write(world)
	}

	private spawn(world: THREE.Matrix4, scale: number) {
		const source = this.source
		const i = this.count++
		const j = i * 3

		// From a point, or from anywhere in the part for an emitter on the part itself.
		tempVector.set(0, 0, 0)

		if (source.box) {
			tempVector.set(
				(Math.random() - 0.5) * source.box[0],
				(Math.random() - 0.5) * source.box[1],
				(Math.random() - 0.5) * source.box[2],
			)
		}

		const origin = tempVector.multiplyScalar(scale).applyMatrix4(world)

		if (source.locked) {
			// Kept in the emitter's space, and placed in the avatar's each frame.
			this.position[j] = source.box ? (Math.random() - 0.5) * source.box[0] * scale : 0
			this.position[j + 1] = source.box ? (Math.random() - 0.5) * source.box[1] * scale : 0
			this.position[j + 2] = source.box ? (Math.random() - 0.5) * source.box[2] * scale : 0
		} else {
			this.position[j] = origin.x
			this.position[j + 1] = origin.y
			this.position[j + 2] = origin.z
		}

		// The emission direction, turned by up to the spread angles around two axes.
		const direction = source.direction.clone()
		const sideways = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
		const u = sideways.cross(direction).normalize()
		const v = direction.clone().cross(u).normalize()

		direction.applyAxisAngle(u, (((Math.random() * 2 - 1) * source.spread[0]) / 180) * Math.PI)
		direction.applyAxisAngle(v, (((Math.random() * 2 - 1) * source.spread[1]) / 180) * Math.PI)

		if (!source.locked) {
			tempQuat.setFromRotationMatrix(world)
			direction.applyQuaternion(tempQuat)
		}

		const speed = between(source.speed) * scale
		this.velocity[j] = direction.x * speed
		this.velocity[j + 1] = direction.y * speed
		this.velocity[j + 2] = direction.z * speed

		this.age[i] = 0
		this.life[i] = Math.max(0.01, between(source.lifetime))
		this.spin[i] = (between(source.rotation) / 180) * Math.PI
		this.turn[i] = (between(source.rotSpeed) / 180) * Math.PI
		this.sizeEnvelope[i] = Math.random() * 2 - 1
		this.fadeEnvelope[i] = Math.random() * 2 - 1
		this.frameStart[i] = source.flipbookStartRandom
			? Math.floor(Math.random() * source.grid * source.grid)
			: 0
		this.frameRate[i] = between(source.flipbookFps)
	}

	private remove(i: number) {
		const last = --this.count

		if (i === last) {
			return
		}

		for (const array of [this.position, this.velocity]) {
			array[i * 3] = array[last * 3]
			array[i * 3 + 1] = array[last * 3 + 1]
			array[i * 3 + 2] = array[last * 3 + 2]
		}

		for (const array of [
			this.age,
			this.life,
			this.spin,
			this.turn,
			this.sizeEnvelope,
			this.fadeEnvelope,
			this.frameStart,
			this.frameRate,
		]) {
			array[i] = array[last]
		}
	}

	private write(world: THREE.Matrix4) {
		const source = this.source
		const position = this.attributes.position.array as Float32Array
		const size = this.attributes.pSize.array as Float32Array
		const alpha = this.attributes.pAlpha.array as Float32Array
		const color = this.attributes.pColor.array as Float32Array
		const rotation = this.attributes.pRotation.array as Float32Array
		const frame = this.attributes.pFrame.array as Float32Array
		const cells = source.grid * source.grid

		for (let i = 0; i < this.count; i++) {
			const j = i * 3
			const t = this.age[i] / this.life[i]

			tempVector.set(this.position[j], this.position[j + 1], this.position[j + 2])

			if (source.locked) {
				tempVector.applyMatrix4(world)
			}

			position[j] = tempVector.x
			position[j + 1] = tempVector.y
			position[j + 2] = tempVector.z

			size[i] = Math.max(0, evaluate(source.size, t, this.sizeEnvelope[i]))
			alpha[i] = 1 - Math.min(1, Math.max(0, evaluate(source.transparency, t, this.fadeEnvelope[i])))

			evaluateColor(source.color, t, tempColor)
			color[j] = tempColor.r * source.brightness
			color[j + 1] = tempColor.g * source.brightness
			color[j + 2] = tempColor.b * source.brightness

			rotation[i] = this.spin[i]
			frame[i] = cells > 1 ? (this.frameStart[i] + this.age[i] * this.frameRate[i]) % cells : 0
		}

		for (const attribute of Object.values(this.attributes)) {
			attribute.needsUpdate = true
		}

		this.points.geometry.setDrawRange(0, this.count)
	}

	dispose() {
		this.points.removeFromParent()
		this.points.geometry.dispose()

		const material = this.points.material as THREE.ShaderMaterial
		const map = material.uniforms.uMap.value

		if (map && map !== softDot) {
			map.dispose()
		}

		material.dispose()
	}
}

/**
 * Roblox's Brightness and Range as three light units. Range cuts the light
 * off, and the intensity is scaled so a light of brightness 1 lights what is
 * near it about as much as the scene's sun.
 */
const LIGHT_SCALE = Math.PI * 2

/** One accessory's effects in the avatar, following its Handle. */
export class AccessoryEffects {
	private readonly emitters: Array<{ emitter: Emitter; source: EmitterSource }> = []
	private readonly lights: Array<{ light: THREE.PointLight | THREE.SpotLight; source: LightSource }> = []
	private last = 0

	constructor(sources: EffectSource[], parent: THREE.Object3D) {
		for (const source of sources) {
			if (source.kind === "particles") {
				const emitter = new Emitter(source)
				parent.add(emitter.points)
				this.emitters.push({ emitter, source })
			} else {
				const light =
					source.type === "point"
						? new THREE.PointLight(source.color, source.brightness * LIGHT_SCALE, source.range, 1)
						: new THREE.SpotLight(
								source.color,
								source.brightness * LIGHT_SCALE,
								source.range,
								Math.min(Math.PI / 2, ((source.angle / 2) * Math.PI) / 180),
								0.3,
								1,
							)

				light.castShadow = false
				parent.add(light)

				if (light instanceof THREE.SpotLight) {
					parent.add(light.target)
				}

				this.lights.push({ light, source })
			}
		}
	}

	/**
	 * Moves the effects with the Handle, `handle` being its place in the
	 * avatar's space without scale, and `scale` the avatar's scale on it.
	 */
	update(handle: THREE.Matrix4, scale: number, visible: boolean) {
		const now = performance.now() / 1000
		// After a pause the preview catches up gently instead of in one jump.
		const dt = this.last ? Math.min(0.1, now - this.last) : 0
		this.last = now

		for (const { emitter, source } of this.emitters) {
			emitter.points.visible = visible
			tempMatrix.copy(source.local)
			tempMatrix.elements[12] *= scale
			tempMatrix.elements[13] *= scale
			tempMatrix.elements[14] *= scale
			emitter.update(visible ? dt : 0, tempMatrix.premultiply(handle), scale)
		}

		for (const { light, source } of this.lights) {
			light.visible = visible
			tempMatrix.copy(source.local)
			tempMatrix.elements[12] *= scale
			tempMatrix.elements[13] *= scale
			tempMatrix.elements[14] *= scale
			tempMatrix.premultiply(handle)
			light.position.setFromMatrixPosition(tempMatrix)

			if (light instanceof THREE.SpotLight) {
				tempQuat.setFromRotationMatrix(tempMatrix)
				light.target.position.copy(source.direction).applyQuaternion(tempQuat).add(light.position)
				light.target.updateMatrixWorld()
			}
		}
	}

	dispose() {
		for (const { emitter } of this.emitters) {
			emitter.dispose()
		}

		for (const { light } of this.lights) {
			light.removeFromParent()

			if (light instanceof THREE.SpotLight) {
				light.target.removeFromParent()
			}

			light.dispose()
		}

		this.emitters.length = 0
		this.lights.length = 0
	}
}
