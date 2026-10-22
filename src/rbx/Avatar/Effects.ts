import * as THREE from "three"
import { AssetCache } from "@/rbx/AssetCache"

// An accessory's particles and lights. They are read from its Handle and the
// attachments in it, and drawn on top of the avatar: particles simulated here
// each frame and drawn as textured quads, lights as three's own. Fire,
// Sparkles and Smoke, the older effects, become emitters shaped like them.

type Sequence = Array<{ Time: number; Value: number; Envelope?: number }>
type ColorSequence = Array<{ Time: number; Value: [number, number, number] }>
type Range = [number, number]

export interface EmitterSource {
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
	/** LightEmission: 0 blends normally, 1 adds its colour. */
	emission: number
	/** Brightness as far as LightInfluence lets it count. */
	brightness: number
	/** ParticleOrientation: facing the camera, upright, along or across the motion. */
	orientation: number
	zOffset: number
	squash: Sequence | null
	locked: boolean
	timeScale: number
	/** Cells per side of a flipbook texture, 1 for none. */
	grid: number
	flipbookFps: Range
	flipbookStartRandom: boolean
	/** ParticleEmitterShape: Box, Sphere, Cylinder, Disc. Only for an emitter on the part. */
	shape: number
	/** Emitting from the whole shape, or only its outside. */
	surface: boolean
	/** ParticleEmitterShapeInOut: Outward, Inward, InAndOut. */
	inOut: number
	partial: number
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
	shadows: boolean
}

/** What beams and trails share: a textured strip between two attachments. */
interface RibbonSource {
	/** The two attachments, in the Handle's space. */
	from: THREE.Matrix4
	to: THREE.Matrix4
	faceCamera: boolean
	texture: string | null
	textureLength: number
	/** TextureMode: Stretch, Wrap, Static. */
	textureMode: number
	color: ColorSequence
	transparency: Sequence
	emission: number
	brightness: number
	zOffset: number
}

interface BeamSource extends RibbonSource {
	kind: "beam"
	curve: [number, number]
	width: [number, number]
	segments: number
	textureSpeed: number
}

interface TrailSource extends RibbonSource {
	kind: "trail"
	lifetime: number
	minLength: number
	maxLength: number
	widthScale: Sequence
}

export type EffectSource = EmitterSource | LightSource | BeamSource | TrailSource

// Roblox's NormalId: Right, Top, Back, Left, Bottom, Front.
const NORMALS = [
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(0, 0, 1),
	new THREE.Vector3(-1, 0, 0),
	new THREE.Vector3(0, -1, 0),
	new THREE.Vector3(0, 0, -1),
]

const lit = (brightness: number, influence: number) => {
	const k = Math.min(1, Math.max(0, influence))
	return brightness * (1 - k) + k
}

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

/** Where an attachment in the Handle sits, or null for one anywhere else, which cannot be followed. */
const attachmentIn = (handle: any, attachment: any) =>
	attachment?.ClassName === "Attachment" && attachment.Parent === handle ? cframe(attachment.CFrame) : null

/** What beams and trails read alike, or null without both attachments. */
const ribbon = (inst: any, handle: any): RibbonSource | null => {
	const from = attachmentIn(handle, inst.Attachment0)
	const to = attachmentIn(handle, inst.Attachment1)

	if (!from || !to) {
		return null
	}

	return {
		from,
		to,
		faceCamera: !!inst.FaceCamera,
		texture: textureUrl(inst.Texture),
		textureLength: Math.max(0.001, +(inst.TextureLength ?? 1)),
		textureMode: +(inst.TextureMode ?? 0),
		color: Array.isArray(inst.Color) && inst.Color.length ? inst.Color : flat([1, 1, 1]),
		transparency: sequence(inst.Transparency, 0.5),
		emission: Math.min(1, Math.max(0, +(inst.LightEmission ?? 0))),
		brightness: lit(+(inst.Brightness ?? 1), +(inst.LightInfluence ?? 0)),
		zOffset: +(inst.ZOffset ?? 0),
	}
}

const fromInstance = (
	inst: any,
	local: THREE.Matrix4,
	box: EmitterSource["box"],
	handle: any,
): EffectSource | null => {
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
				emission: Math.min(1, Math.max(0, +(inst.LightEmission ?? 0))),
				// Brightness only counts as far as world lighting does not.
				brightness: lit(+(inst.Brightness ?? 1), +(inst.LightInfluence ?? 0)),
				orientation: +(inst.Orientation ?? 0),
				zOffset: +(inst.ZOffset ?? 0),
				squash:
					Array.isArray(inst.Squash) &&
					inst.Squash.some((point: any) => point.Value || point.Envelope)
						? inst.Squash
						: null,
				locked: !!inst.LockedToPart,
				timeScale: +(inst.TimeScale ?? 1),
				grid: [1, 2, 4, 8][inst.FlipbookLayout ?? 0] ?? 1,
				flipbookFps: range(inst.FlipbookFramerate, [1, 1]),
				flipbookStartRandom: !!inst.FlipbookStartRandom,
				shape: +(inst.Shape ?? 0),
				surface: +(inst.ShapeStyle ?? 0) === 1,
				inOut: +(inst.ShapeInOut ?? 0),
				partial: Math.min(1, Math.max(0, +(inst.ShapePartial ?? 1))),
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
				emission: 1,
				brightness: 1,
				orientation: 0,
				zOffset: 0,
				squash: null,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
				shape: 0,
				surface: false,
				inOut: 0,
				partial: 1,
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
				emission: 0,
				brightness: 1.5,
				orientation: 0,
				zOffset: 0,
				squash: null,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
				shape: 0,
				surface: false,
				inOut: 0,
				partial: 1,
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
				emission: 0,
				brightness: 1,
				orientation: 0,
				zOffset: 0,
				squash: null,
				locked: false,
				timeScale: 1,
				grid: 1,
				flipbookFps: [1, 1],
				flipbookStartRandom: false,
				shape: 0,
				surface: false,
				inOut: 0,
				partial: 1,
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
				shadows: !!inst.Shadows,
			}

		case "Beam": {
			const shared = ribbon(inst, handle)
			return shared
				? {
						...shared,
						kind: "beam",
						curve: [+(inst.CurveSize0 ?? 0), +(inst.CurveSize1 ?? 0)],
						width: [+(inst.Width0 ?? 1), +(inst.Width1 ?? 1)],
						segments: Math.min(100, Math.max(1, Math.round(+(inst.Segments ?? 10)))),
						textureSpeed: +(inst.TextureSpeed ?? 1),
					}
				: null
		}

		case "Trail": {
			const shared = ribbon(inst, handle)
			return shared
				? {
						...shared,
						kind: "trail",
						lifetime: Math.min(20, Math.max(0.01, +(inst.Lifetime ?? 2))),
						minLength: Math.max(0, +(inst.MinLength ?? 0.1)),
						maxLength: Math.max(0, +(inst.MaxLength ?? 0)),
						widthScale: sequence(inst.WidthScale, 1),
					}
				: null
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
				const effect = fromInstance(inner, local, null, handle)
				if (effect) {
					effects.push(effect)
				}
			}
		} else {
			const effect = fromInstance(child, new THREE.Matrix4(), size, handle)
			if (effect) {
				effects.push(effect)
			}
		}
	}

	return effects
}

export const evaluate = (points: Sequence, t: number, envelope: number) => {
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
		softDot.premultiplyAlpha = true
	}

	return softDot
}

// Each particle is a quad, placed and turned on the GPU: facing the camera,
// standing up, or lined up with where it is going, as Orientation says.
const VERTEX = `
	attribute vec3 iCenter;
	attribute vec3 iVelocity;
	attribute vec2 iSize;
	attribute float iAlpha;
	attribute vec3 iColor;
	attribute float iRotation;
	attribute float iFrame;
	uniform float uOrientation;
	uniform float uZOffset;
	varying vec2 vUv;
	varying float vAlpha;
	varying vec3 vColor;
	varying float vFrame;

	void main() {
		vec3 center = (modelViewMatrix * vec4(iCenter, 1.0)).xyz;
		vec3 toEye = normalize(-center);
		vec3 right = vec3(1.0, 0.0, 0.0);
		vec3 up = vec3(0.0, 1.0, 0.0);

		if (uOrientation > 0.5) {
			vec3 axis = uOrientation < 1.5
				? (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz
				: (modelViewMatrix * vec4(iVelocity, 0.0)).xyz;
			float length_ = length(axis);

			if (length_ > 1e-5) {
				axis /= length_;

				if (uOrientation < 2.5) {
					// Upright along the axis, turned to the camera as far as that allows.
					vec3 side = cross(axis, toEye);

					if (length(side) > 1e-5) {
						up = axis;
						right = normalize(side);
					}
				} else {
					// Flat across the direction of travel.
					vec3 helper = abs(axis.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
					right = normalize(cross(helper, axis));
					up = cross(axis, right);
				}
			}
		}

		vec2 corner = position.xy * iSize;
		float c = cos(iRotation);
		float s = sin(iRotation);
		corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);

		vec3 view = center + right * corner.x + up * corner.y;

		// ZOffset moves it along the line of sight, scaled to cover the same pixels.
		float depth = length(center);
		view *= max(0.01, (depth - uZOffset) / max(depth, 1e-4));

		gl_Position = projectionMatrix * vec4(view, 1.0);
		vUv = position.xy + 0.5;
		vAlpha = iAlpha;
		vColor = iColor;
		vFrame = iFrame;
	}
`

// Textures are premultiplied, so filtering does not leave dark edges, and
// LightEmission moves from blending normally towards adding the colour on top.
const FRAGMENT = `
	uniform sampler2D uMap;
	uniform float uGrid;
	uniform float uEmission;
	varying vec2 vUv;
	varying float vAlpha;
	varying vec3 vColor;
	varying float vFrame;

	void main() {
		// Kept off the cell's border, so a flipbook does not show its neighbours.
		vec2 p = clamp(vUv, 0.004, 0.996);
		float cell = floor(vFrame);
		vec2 uv = (vec2(mod(cell, uGrid), uGrid - 1.0 - floor(cell / uGrid)) + p) / uGrid;
		vec4 texel = texture2D(uMap, uv) * vAlpha;

		if (texel.a < 0.002 && max(texel.r, max(texel.g, texel.b)) < 0.002) {
			discard;
		}

		vec3 rgb = texel.rgb * vColor;

		// The canvas is see-through over the page, where light added to nothing
		// would not show, so added light covers the canvas as far as it is bright.
		float glow = min(1.0, max(rgb.r, max(rgb.g, rgb.b)));
		gl_FragColor = vec4(rgb, mix(texel.a, glow, uEmission));
	}
`

const tempMatrix = new THREE.Matrix4()
// Its own, as sorting runs while the shared one still holds the emitter's place.
const sortMatrix = new THREE.Matrix4()
const tempVector = new THREE.Vector3()
const tempColor = new THREE.Color()
const tempQuat = new THREE.Quaternion()

/**
 * A spawn point in the part's shape, and the way out of it there. The shape
 * fills the part: a sphere is stretched to its size, and a cylinder or disc
 * has its axis along the emission direction. Partial narrows a cylinder at
 * that end, opens a hole in a disc and limits a sphere to a cap.
 */
export const shapePoint = (
	source: EmitterSource,
	box: [number, number, number],
	point: THREE.Vector3,
	out: THREE.Vector3,
) => {
	const half = new THREE.Vector3(box[0] / 2, box[1] / 2, box[2] / 2)
	const axis = source.direction
	// Two directions across the axis, along the part's own sides.
	const across =
		Math.abs(axis.x) > 0.5
			? [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
			: Math.abs(axis.y) > 0.5
				? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]
				: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]
	const angle = Math.random() * Math.PI * 2
	const radial = across[0]
		.clone()
		.multiplyScalar(Math.cos(angle))
		.addScaledVector(across[1], Math.sin(angle))

	switch (source.shape) {
		case 1: {
			// Sphere: a direction within the cap, then out to the surface or anywhere inside.
			const cos = 1 - Math.random() * (1 - Math.cos(Math.PI * source.partial))
			out.copy(axis)
				.multiplyScalar(cos)
				.addScaledVector(radial, Math.sqrt(Math.max(0, 1 - cos * cos)))
			const reach = source.surface ? 1 : Math.cbrt(Math.random())
			point.copy(out).multiply(half).multiplyScalar(reach)
			return
		}

		case 2: {
			// Cylinder: along the axis, out to a radius that narrows towards the emission end.
			const along = Math.random() * 2 - 1
			const radius = 1 + (source.partial - 1) * ((along + 1) / 2)
			const reach = (source.surface ? 1 : Math.sqrt(Math.random())) * radius
			point.copy(axis).multiplyScalar(along).addScaledVector(radial, reach).multiply(half)
			out.copy(radial)
			return
		}

		case 3: {
			// Disc: flat across the axis, a ring once partial opens its middle.
			const inner = 1 - source.partial
			const reach = source.surface ? 1 : Math.sqrt(inner * inner + Math.random() * (1 - inner * inner))
			point.copy(radial).multiplyScalar(reach).multiply(half)
			out.copy(axis)
			return
		}

		default:
			if (source.surface) {
				// Box surface: a face picked by its area, then anywhere on it.
				const areas = [box[1] * box[2], box[0] * box[2], box[0] * box[1]]
				let pick = Math.random() * (areas[0] + areas[1] + areas[2])
				const face = pick < areas[0] ? 0 : (pick -= areas[0]) < areas[1] ? 1 : 2
				point.set(
					(Math.random() * 2 - 1) * half.x,
					(Math.random() * 2 - 1) * half.y,
					(Math.random() * 2 - 1) * half.z,
				)
				point.setComponent(face, (Math.random() < 0.5 ? -1 : 1) * half.getComponent(face))
			} else {
				point.set(
					(Math.random() - 0.5) * box[0],
					(Math.random() - 0.5) * box[1],
					(Math.random() - 0.5) * box[2],
				)
			}

			out.copy(axis)
	}
}

/** Squash as width and height factors: above 0 narrower and taller, below 0 wider and shorter. */
export const squashed = (squash: number): [number, number] =>
	squash >= 0 ? [1 / (1 + squash), 1 + squash] : [1 - squash, 1 / (1 - squash)]

class Emitter {
	readonly mesh: THREE.Mesh
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
	private readonly squashEnvelope: Float32Array
	private readonly frameStart: Float32Array
	private readonly frameRate: Float32Array

	/** Back to front, for emitters that are not purely additive. */
	private readonly order: Uint32Array
	private readonly depth: Float32Array
	/** The camera last drawn with, which sorting goes by. */
	private camera: THREE.Camera | null = null

	private readonly geometry: THREE.InstancedBufferGeometry
	private readonly attributes: Record<string, THREE.InstancedBufferAttribute>

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
		this.squashEnvelope = new Float32Array(n)
		this.frameStart = new Float32Array(n)
		this.frameRate = new Float32Array(n)
		this.order = new Uint32Array(n)
		this.depth = new Float32Array(n)

		this.geometry = new THREE.InstancedBufferGeometry()
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(
				new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
				3,
			),
		)
		this.geometry.setIndex([0, 1, 2, 0, 2, 3])

		this.attributes = {
			iCenter: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
			iVelocity: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
			iSize: new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2),
			iAlpha: new THREE.InstancedBufferAttribute(new Float32Array(n), 1),
			iColor: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
			iRotation: new THREE.InstancedBufferAttribute(new Float32Array(n), 1),
			iFrame: new THREE.InstancedBufferAttribute(new Float32Array(n), 1),
		}

		for (const [name, attribute] of Object.entries(this.attributes)) {
			attribute.setUsage(THREE.DynamicDrawUsage)
			this.geometry.setAttribute(name, attribute)
		}

		this.geometry.instanceCount = 0

		const material = new THREE.ShaderMaterial({
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			uniforms: {
				uMap: { value: defaultTexture() },
				uGrid: { value: 1 },
				uEmission: { value: source.emission },
				uOrientation: { value: source.orientation },
				uZOffset: { value: source.zOffset },
			},
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
		})

		this.mesh = new THREE.Mesh(this.geometry, material)
		this.mesh.frustumCulled = false
		this.mesh.matrixAutoUpdate = false
		this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
			this.camera = camera
		}

		if (source.texture) {
			AssetCache.loadImage(true, source.texture, (img: HTMLImageElement | null) => {
				if (!img) {
					return
				}

				const texture = new THREE.Texture(img)
				texture.premultiplyAlpha = true
				texture.anisotropy = 4
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

		// Drag is how quickly speed halves.
		const damp = 0.5 ** (source.drag * step)

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

		// From a point, or from the part's shape for an emitter on the part itself.
		const direction = source.direction.clone()
		tempVector.set(0, 0, 0)

		if (source.box) {
			shapePoint(source, source.box, tempVector, direction)
		}

		// Inward turns around, and InAndOut picks either way for each particle.
		if (source.inOut === 1 || (source.inOut === 2 && Math.random() < 0.5)) {
			direction.negate()
		}

		if (source.locked) {
			// Kept in the emitter's space, and placed in the avatar's each frame.
			tempVector.multiplyScalar(scale)
		} else {
			tempVector.multiplyScalar(scale).applyMatrix4(world)
		}

		this.position[j] = tempVector.x
		this.position[j + 1] = tempVector.y
		this.position[j + 2] = tempVector.z

		// The emission direction, turned by up to the spread angles around two axes.
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
		this.squashEnvelope[i] = Math.random() * 2 - 1
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
			this.squashEnvelope,
			this.frameStart,
			this.frameRate,
		]) {
			array[i] = array[last]
		}
	}

	/** Sorts back to front by the last camera, a frame behind, which does not show. */
	private sort(world: THREE.Matrix4) {
		const order = this.order

		for (let i = 0; i < this.count; i++) {
			order[i] = i
		}

		if (!this.camera || this.source.emission >= 1 || this.count < 2) {
			return
		}

		sortMatrix.multiplyMatrices(this.camera.matrixWorldInverse, this.mesh.matrixWorld)

		if (this.source.locked) {
			sortMatrix.multiply(world)
		}

		const e = sortMatrix.elements

		for (let i = 0; i < this.count; i++) {
			const j = i * 3
			this.depth[i] =
				e[2] * this.position[j] + e[6] * this.position[j + 1] + e[10] * this.position[j + 2]
		}

		order.subarray(0, this.count).sort((a, b) => this.depth[a] - this.depth[b])
	}

	private write(world: THREE.Matrix4) {
		const source = this.source
		const a = this.attributes
		const center = a.iCenter.array as Float32Array
		const velocity = a.iVelocity.array as Float32Array
		const size = a.iSize.array as Float32Array
		const alpha = a.iAlpha.array as Float32Array
		const color = a.iColor.array as Float32Array
		const rotation = a.iRotation.array as Float32Array
		const frame = a.iFrame.array as Float32Array
		const cells = source.grid * source.grid

		tempQuat.setFromRotationMatrix(world)
		this.sort(world)

		for (let k = 0; k < this.count; k++) {
			const i = this.order[k]
			const j = i * 3
			const o = k * 3
			const t = this.age[i] / this.life[i]

			tempVector.set(this.position[j], this.position[j + 1], this.position[j + 2])

			if (source.locked) {
				tempVector.applyMatrix4(world)
			}

			center[o] = tempVector.x
			center[o + 1] = tempVector.y
			center[o + 2] = tempVector.z

			tempVector.set(this.velocity[j], this.velocity[j + 1], this.velocity[j + 2])

			if (source.locked) {
				tempVector.applyQuaternion(tempQuat)
			}

			velocity[o] = tempVector.x
			velocity[o + 1] = tempVector.y
			velocity[o + 2] = tempVector.z

			const s = Math.max(0, evaluate(source.size, t, this.sizeEnvelope[i]))
			const [w, h] = source.squash
				? squashed(evaluate(source.squash, t, this.squashEnvelope[i]))
				: [1, 1]
			size[k * 2] = s * w
			size[k * 2 + 1] = s * h

			alpha[k] = 1 - Math.min(1, Math.max(0, evaluate(source.transparency, t, this.fadeEnvelope[i])))

			evaluateColor(source.color, t, tempColor)
			color[o] = tempColor.r * source.brightness
			color[o + 1] = tempColor.g * source.brightness
			color[o + 2] = tempColor.b * source.brightness

			rotation[k] = this.spin[i]
			frame[k] = cells > 1 ? (this.frameStart[i] + this.age[i] * this.frameRate[i]) % cells : 0
		}

		for (const attribute of Object.values(a)) {
			attribute.needsUpdate = true
		}

		this.geometry.instanceCount = this.count
	}

	dispose() {
		this.mesh.removeFromParent()
		this.geometry.dispose()

		const material = this.mesh.material as THREE.ShaderMaterial
		const map = material.uniforms.uMap.value

		if (map && map !== softDot) {
			map.dispose()
		}

		material.dispose()
	}
}

// Beams and trails are strips: two vertices across each point along them,
// spread either along a fixed direction or across the line of sight.
const RIBBON_VERTEX = `
	attribute vec3 aSide;
	attribute vec3 aTangent;
	attribute float aEdge;
	attribute vec4 aColor;
	uniform float uFaceCamera;
	uniform float uZOffset;
	varying vec2 vUv;
	varying vec4 vColor;

	void main() {
		vec3 center = (modelViewMatrix * vec4(position, 1.0)).xyz;
		vec3 view;

		if (uFaceCamera > 0.5) {
			vec3 tangent = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
			vec3 side = cross(tangent, normalize(-center));
			float length_ = length(side);
			view = center + (length_ > 1e-5 ? side / length_ : vec3(0.0, 1.0, 0.0)) * length(aSide) * aEdge;
		} else {
			view = (modelViewMatrix * vec4(position + aSide * aEdge, 1.0)).xyz;
		}

		float depth = length(center);
		view *= max(0.01, (depth - uZOffset) / max(depth, 1e-4));

		gl_Position = projectionMatrix * vec4(view, 1.0);
		vUv = uv;
		vColor = aColor;
	}
`

const RIBBON_FRAGMENT = `
	uniform sampler2D uMap;
	uniform float uEmission;
	uniform float uOffset;
	varying vec2 vUv;
	varying vec4 vColor;

	void main() {
		vec4 texel = texture2D(uMap, vec2(vUv.x - uOffset, vUv.y)) * vColor.a;
		vec3 rgb = texel.rgb * vColor.rgb;

		if (texel.a < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) {
			discard;
		}

		float glow = min(1.0, max(rgb.r, max(rgb.g, rgb.b)));
		gl_FragColor = vec4(rgb, mix(texel.a, glow, uEmission));
	}
`

/** Plain white, for a beam or trail drawn in its colour alone. */
let white: THREE.Texture | null = null

const whiteTexture = () => {
	if (!white) {
		white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
		white.needsUpdate = true
	}

	return white
}

/** One point along a strip. */
interface Section {
	center: THREE.Vector3
	/** Half its width, pointing to one edge. */
	side: THREE.Vector3
	tangent: THREE.Vector3
	u: number
	/** How far along, or how old, for its colour and transparency. */
	t: number
}

class Ribbon {
	readonly mesh: THREE.Mesh
	private readonly source: RibbonSource
	private readonly capacity: number
	private readonly geometry: THREE.BufferGeometry
	private readonly material: THREE.ShaderMaterial

	constructor(source: RibbonSource, capacity: number) {
		this.source = source
		this.capacity = capacity

		const vertices = capacity * 2
		this.geometry = new THREE.BufferGeometry()

		for (const [name, size] of [
			["position", 3],
			["aSide", 3],
			["aTangent", 3],
			["aEdge", 1],
			["uv", 2],
			["aColor", 4],
		] as const) {
			const attribute = new THREE.BufferAttribute(new Float32Array(vertices * size), size)
			attribute.setUsage(THREE.DynamicDrawUsage)
			this.geometry.setAttribute(name, attribute)
		}

		const edge = this.geometry.attributes.aEdge.array as Float32Array
		const index: number[] = []

		for (let i = 0; i < capacity; i++) {
			edge[i * 2] = -1
			edge[i * 2 + 1] = 1

			if (i < capacity - 1) {
				const a = i * 2
				index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
			}
		}

		this.geometry.setIndex(index)
		this.geometry.setDrawRange(0, 0)

		this.material = new THREE.ShaderMaterial({
			vertexShader: RIBBON_VERTEX,
			fragmentShader: RIBBON_FRAGMENT,
			uniforms: {
				uMap: { value: whiteTexture() },
				uEmission: { value: source.emission },
				uOffset: { value: 0 },
				uFaceCamera: { value: source.faceCamera ? 1 : 0 },
				uZOffset: { value: source.zOffset },
			},
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
		})

		this.mesh = new THREE.Mesh(this.geometry, this.material)
		this.mesh.frustumCulled = false
		this.mesh.matrixAutoUpdate = false

		if (source.texture) {
			AssetCache.loadImage(true, source.texture, (img: HTMLImageElement | null) => {
				if (!img) {
					return
				}

				const texture = new THREE.Texture(img)
				texture.premultiplyAlpha = true
				texture.wrapS = THREE.RepeatWrapping
				texture.anisotropy = 4
				texture.needsUpdate = true
				this.material.uniforms.uMap.value = texture
			})
		}
	}

	set offset(value: number) {
		this.material.uniforms.uOffset.value = value
	}

	/** Lays the strip through these points, at most as many as it was made for. */
	draw(sections: Section[]) {
		const count = Math.min(sections.length, this.capacity)
		const a = this.geometry.attributes
		const position = a.position.array as Float32Array
		const side = a.aSide.array as Float32Array
		const tangent = a.aTangent.array as Float32Array
		const uv = a.uv.array as Float32Array
		const color = a.aColor.array as Float32Array

		for (let i = 0; i < count; i++) {
			const section = sections[i]
			const alpha = 1 - Math.min(1, Math.max(0, evaluate(this.source.transparency, section.t, 0)))
			evaluateColor(this.source.color, section.t, tempColor)

			for (let k = 0; k < 2; k++) {
				const v = i * 2 + k
				section.center.toArray(position, v * 3)
				section.side.toArray(side, v * 3)
				section.tangent.toArray(tangent, v * 3)
				uv[v * 2] = section.u
				uv[v * 2 + 1] = k
				color[v * 4] = tempColor.r * this.source.brightness
				color[v * 4 + 1] = tempColor.g * this.source.brightness
				color[v * 4 + 2] = tempColor.b * this.source.brightness
				color[v * 4 + 3] = alpha
			}
		}

		for (const attribute of Object.values(a)) {
			attribute.needsUpdate = true
		}

		this.geometry.setDrawRange(0, count >= 2 ? (count - 1) * 6 : 0)
	}

	dispose() {
		this.mesh.removeFromParent()
		this.geometry.dispose()

		const map = this.material.uniforms.uMap.value

		if (map && map !== white) {
			map.dispose()
		}

		this.material.dispose()
	}
}

const tempA = new THREE.Vector3()
const tempB = new THREE.Vector3()
const tempAxisA = new THREE.Vector3()
const tempAxisB = new THREE.Vector3()

/**
 * A curve between two attachments, bent along each one's X axis by its curve
 * size. Its width lies along the attachments' Y axes when it does not face
 * the camera.
 */
class BeamRuntime {
	readonly ribbon: Ribbon
	private readonly source: BeamSource
	private readonly sections: Section[]

	constructor(source: BeamSource) {
		this.source = source
		this.ribbon = new Ribbon(source, source.segments + 1)
		this.sections = Array.from({ length: source.segments + 1 }, () => ({
			center: new THREE.Vector3(),
			side: new THREE.Vector3(),
			tangent: new THREE.Vector3(),
			u: 0,
			t: 0,
		}))
	}

	update(from: THREE.Matrix4, to: THREE.Matrix4, scale: number, time: number) {
		const source = this.source
		const p0 = tempA.setFromMatrixPosition(from)
		const p3 = tempB.setFromMatrixPosition(to)
		const p1 = new THREE.Vector3()
			.setFromMatrixColumn(from, 0)
			.normalize()
			.multiplyScalar(source.curve[0] * scale)
			.add(p0)
		const p2 = new THREE.Vector3()
			.setFromMatrixColumn(to, 0)
			.normalize()
			.multiplyScalar(-source.curve[1] * scale)
			.add(p3)
		const upA = tempAxisA.setFromMatrixColumn(from, 1).normalize()
		const upB = tempAxisB.setFromMatrixColumn(to, 1).normalize()

		let distance = 0

		for (let i = 0; i < this.sections.length; i++) {
			const t = i / source.segments
			const section = this.sections[i]
			const s = 1 - t

			section.center
				.copy(p0)
				.multiplyScalar(s * s * s)
				.addScaledVector(p1, 3 * s * s * t)
				.addScaledVector(p2, 3 * s * t * t)
				.addScaledVector(p3, t * t * t)

			section.tangent
				.copy(p1)
				.sub(p0)
				.multiplyScalar(3 * s * s)
				.addScaledVector(p2.clone().sub(p1), 6 * s * t)
				.addScaledVector(p3.clone().sub(p2), 3 * t * t)

			if (section.tangent.lengthSq() < 1e-10) {
				section.tangent.copy(p3).sub(p0)
			}

			section.tangent.normalize()

			// The attachments' up, turned to lie across the curve.
			const width = (source.width[0] + (source.width[1] - source.width[0]) * t) * scale
			section.side.copy(upA).lerp(upB, t)
			section.side.addScaledVector(section.tangent, -section.side.dot(section.tangent))

			if (section.side.lengthSq() < 1e-10) {
				section.side.set(0, 1, 0)
			}

			section.side.normalize().multiplyScalar(width / 2)

			if (i > 0) {
				distance += section.center.distanceTo(this.sections[i - 1].center)
			}

			// Stretch fits a number of repeats along it, the others repeat every so many studs.
			section.u =
				source.textureMode === 0
					? t * source.textureLength
					: distance / (source.textureLength * scale)
			section.t = t
		}

		this.ribbon.offset = time * source.textureSpeed
		this.ribbon.draw(this.sections)
	}
}

/**
 * The path two attachments leave behind as they move, kept for its lifetime.
 * Its colour, transparency and width follow each point's age.
 */
class TrailRuntime {
	readonly ribbon: Ribbon
	private readonly source: TrailSource
	private readonly points: Array<{ a: THREE.Vector3; b: THREE.Vector3; age: number; stamp: number }> = []
	private travelled = 0

	constructor(source: TrailSource) {
		this.source = source
		this.ribbon = new Ribbon(source, 256)
	}

	update(from: THREE.Matrix4, to: THREE.Matrix4, scale: number, dt: number) {
		const source = this.source
		const a = new THREE.Vector3().setFromMatrixPosition(from)
		const b = new THREE.Vector3().setFromMatrixPosition(to)

		for (const point of this.points) {
			point.age += dt
		}

		while (this.points.length && this.points[0].age >= source.lifetime) {
			this.points.shift()
		}

		const last = this.points.at(-1)
		const moved = last ? Math.max(last.a.distanceTo(a), last.b.distanceTo(b)) : Infinity

		if (moved >= source.minLength * scale) {
			if (last) {
				this.travelled += last.a.clone().add(last.b).distanceTo(a.clone().add(b)) / 2
			}

			this.points.push({ a, b, age: 0, stamp: this.travelled })

			if (this.points.length > 255) {
				this.points.shift()
			}
		}

		// Newest first, from where the attachments are now.
		const path = [{ a, b, age: 0, stamp: this.travelled }, ...this.points.toReversed()]
		const sections: Section[] = []
		let distance = 0

		for (let i = 0; i < path.length; i++) {
			const point = path[i]
			const center = point.a.clone().add(point.b).multiplyScalar(0.5)

			if (i > 0) {
				const step = center.distanceTo(sections[i - 1].center)

				if (source.maxLength > 0 && distance + step > source.maxLength * scale) {
					break
				}

				distance += step
			}

			const t = point.age / source.lifetime
			const next = path[i + 1] ?? path[i - 1]
			const tangent = next
				? next.a.clone().add(next.b).multiplyScalar(0.5).sub(center)
				: new THREE.Vector3(0, 1, 0)

			if (i > 0 && path[i + 1] === undefined) {
				tangent.negate()
			}

			sections.push({
				center,
				side: point.b
					.clone()
					.sub(point.a)
					.multiplyScalar(0.5 * Math.max(0, evaluate(source.widthScale, t, 0))),
				tangent: tangent.lengthSq() > 1e-10 ? tangent.normalize() : new THREE.Vector3(0, 1, 0),
				u: 0,
				t,
			})
		}

		const total = distance || 1

		for (let i = 0, along = 0; i < sections.length; i++) {
			if (i > 0) {
				along += sections[i].center.distanceTo(sections[i - 1].center)
			}

			const stamp = path[i].stamp
			sections[i].u =
				source.textureMode === 0
					? (along / total) * source.textureLength
					: source.textureMode === 1
						? along / (source.textureLength * scale)
						: stamp / (source.textureLength * scale)
		}

		this.ribbon.draw(sections)
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
	private readonly ribbons: Array<{
		runtime: BeamRuntime | TrailRuntime
		source: BeamSource | TrailSource
	}> = []
	private readonly parent: THREE.Object3D
	/** Whether a light here casts shadows, which the avatar then has to take. */
	private readonly shadowing: boolean
	private last = 0
	private time = 0

	/** `shadows` lets lights that ask for shadows cast them, which costs a render per light. */
	constructor(sources: EffectSource[], parent: THREE.Object3D, options: { shadows?: boolean } = {}) {
		this.parent = parent
		let shadowing = false

		for (const source of sources) {
			if (source.kind === "particles") {
				const emitter = new Emitter(source)
				parent.add(emitter.mesh)
				this.emitters.push({ emitter, source })
			} else if (source.kind === "beam" || source.kind === "trail") {
				const runtime = source.kind === "beam" ? new BeamRuntime(source) : new TrailRuntime(source)
				parent.add(runtime.ribbon.mesh)
				this.ribbons.push({ runtime, source })
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

				// Spot lights only: the scene's soft shadows are VSM, which three
				// does not do for point lights.
				light.castShadow = !!options.shadows && source.shadows && source.type === "spot"

				if (light.castShadow) {
					shadowing = true
					light.shadow.mapSize.set(512, 512)
					light.shadow.camera.near = 0.2
					light.shadow.camera.far = source.range
					light.shadow.radius = 2
					// Less than this striped the ground and the arms with acne.
					light.shadow.normalBias = 0.1
					light.shadow.bias = -0.001
				}

				parent.add(light)

				if (light instanceof THREE.SpotLight) {
					parent.add(light.target)
				}

				this.lights.push({ light, source })
			}
		}

		this.shadowing = shadowing
	}

	/** Where a Handle-space attachment is in the avatar, at the avatar's scale. */
	private place(out: THREE.Matrix4, local: THREE.Matrix4, handle: THREE.Matrix4, scale: number) {
		out.copy(local)
		out.elements[12] *= scale
		out.elements[13] *= scale
		out.elements[14] *= scale
		return out.premultiply(handle)
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
		this.time += visible ? dt : 0

		for (const { runtime, source } of this.ribbons) {
			runtime.ribbon.mesh.visible = visible
			const from = this.place(new THREE.Matrix4(), source.from, handle, scale)
			const to = this.place(new THREE.Matrix4(), source.to, handle, scale)
			runtime.update(from, to, scale, runtime instanceof BeamRuntime ? this.time : visible ? dt : 0)
		}

		// Shadows from these lights only show on what takes them, so the avatar
		// does while one is here. Its parts come and go, so this is kept up.
		if (this.shadowing && visible) {
			this.parent.traverse((obj) => {
				if ((obj as THREE.Mesh).isMesh && obj.castShadow) {
					obj.receiveShadow = true
				}
			})
		}

		for (const { emitter, source } of this.emitters) {
			emitter.mesh.visible = visible
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

		for (const { runtime } of this.ribbons) {
			runtime.ribbon.dispose()
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
		this.ribbons.length = 0
	}
}
