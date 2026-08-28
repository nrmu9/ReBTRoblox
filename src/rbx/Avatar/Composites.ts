import * as THREE from "three"
import { AssetCache } from "@/rbx/AssetCache"
import { RBXAvatar } from "@/rbx/Avatar/Avatar"
import type { Mesh } from "@/rbx/Parser/MeshParser"

/** A texture producer that can tell its consumers when it has changed. */
interface CompositeSource {
	toTexture(): THREE.Texture
	onUpdate(fn: () => void): void
	[key: string]: any
}

/**
 * What an avatar hands its composites. Deliberately loose: the slots are not
 * uniform, some hold a texture source and others a nested group of them, so
 * naming them all would claim a shape the avatar does not actually keep.
 * The precision that matters is on applySourceToMaterial below.
 */
type CompositeSources = Record<string, any>

/** The subset of a three material these composites actually touch. */
type TexturedMaterial = THREE.Material & { map: THREE.Texture | null }

export const RBXComposites = (() => {
	const applySourceToMaterial = (source: CompositeSource, material: TexturedMaterial) => {
		material.map = source.toTexture()

		source.onUpdate(() => {
			material.map = source.toTexture()
		})
	}

	class CompositeTexture {
		[key: string]: any

		constructor(width?: any, height?: any) {
			this.canvas = document.createElement("canvas")
			this.context = this.canvas.getContext("2d")

			this.scene = new THREE.Scene()

			this.updateListeners = []
			this.loaders = []

			this.width = width
			this.height = height

			this.canvas.width = this.width
			this.canvas.height = this.height

			this.requestUpdate()
		}

		beforeComposite() {}
		afterComposite() {}

		requestUpdate() {
			this.needsUpdate = true
		}

		update(renderer: THREE.WebGLRenderer) {
			this.needsUpdate = false

			this.context.clearRect(0, 0, this.width, this.height)
			this.beforeComposite()

			renderer.setSize(this.width, this.height, false)
			renderer.render(this.scene, this.camera)

			this.context.drawImage(
				renderer.domElement,
				0,
				0,
				this.width,
				this.height,
				0,
				0,
				this.width,
				this.height,
			)

			this.afterComposite()

			for (const fn of this.updateListeners) {
				fn(this)
			}
		}

		drawImage(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
			ctx.drawImage(this.canvas, 0, 0, this.width, this.height, 0, 0, canvas.width, canvas.height)
		}

		onUpdate(fn: () => void) {
			this.updateListeners.push(fn)
		}
	}

	class R6Composite extends CompositeTexture {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(1024, 512)
			this.sources = sources

			const size = 2

			this.camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 4, -size / 4, 0.1, 100)
			this.scene.scale.set(size / 1024, size / 1024, size / 1024)
			this.camera.position.set(size / 2, size / 4, 10)
			this.camera.rotation.set(0, 0, 0)
			this.camera.updateProjectionMatrix()

			const pantsmesh = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			pantsmesh.frustumCulled = false
			pantsmesh.renderOrder = 1
			this.scene.add(pantsmesh)

			const shirtmesh = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			shirtmesh.frustumCulled = false
			shirtmesh.renderOrder = 2
			this.scene.add(shirtmesh)

			const tshirtmesh = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			tshirtmesh.frustumCulled = false
			tshirtmesh.renderOrder = 3
			this.scene.add(tshirtmesh)

			applySourceToMaterial(this.sources.pants, pantsmesh.material)
			applySourceToMaterial(this.sources.shirt, shirtmesh.material)
			applySourceToMaterial(this.sources.tshirt, tshirtmesh.material)

			this.sources.pants.onUpdate(() => this.requestUpdate())
			this.sources.shirt.onUpdate(() => this.requestUpdate())
			this.sources.tshirt.onUpdate(() => this.requestUpdate())

			let meshUrl = RBXAvatar.LocalAssets["res/previewer/compositing/CompositShirtTemplate.mesh"]
			this.loaders.push(
				AssetCache.loadMesh(
					true,
					meshUrl,
					(mesh: Mesh | null) => mesh && RBXAvatar.applyMesh(shirtmesh, mesh),
				),
			)

			meshUrl = RBXAvatar.LocalAssets["res/previewer/compositing/CompositPantsTemplate.mesh"]
			this.loaders.push(
				AssetCache.loadMesh(
					true,
					meshUrl,
					(mesh: Mesh | null) => mesh && RBXAvatar.applyMesh(pantsmesh, mesh),
				),
			)

			meshUrl = RBXAvatar.LocalAssets["res/previewer/compositing/CompositTShirt.mesh"]
			this.loaders.push(
				AssetCache.loadMesh(
					true,
					meshUrl,
					(mesh: Mesh | null) => mesh && RBXAvatar.applyMesh(tshirtmesh, mesh),
				),
			)
		}
	}

	class R15TorsoComposite extends CompositeTexture {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(388, 272)
			this.sources = sources

			this.camera = new THREE.OrthographicCamera(
				-this.width / 2,
				this.width / 2,
				this.height / 2,
				-this.height / 2,
				0.1,
				1000,
			)
			this.camera.position.set(this.width / 2, this.height / 2, 10)
			this.camera.rotation.set(0, 0, 0)
			this.camera.updateProjectionMatrix()

			const pantsmesh = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			pantsmesh.frustumCulled = false
			pantsmesh.renderOrder = 1
			this.scene.add(pantsmesh)

			const shirtmesh = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			shirtmesh.frustumCulled = false
			shirtmesh.renderOrder = 2
			this.scene.add(shirtmesh)

			applySourceToMaterial(this.sources.pants, pantsmesh.material)
			applySourceToMaterial(this.sources.shirt, shirtmesh.material)

			this.sources.pants.onUpdate(() => this.requestUpdate())
			this.sources.shirt.onUpdate(() => this.requestUpdate())
			this.sources.tshirt.onUpdate(() => this.requestUpdate())

			const meshUrl = RBXAvatar.LocalAssets["res/previewer/compositing/R15CompositTorsoBase.mesh"]
			this.loaders.push(
				AssetCache.loadMesh(true, meshUrl, (mesh: Mesh | null) => {
					if (!mesh) {
						return
					}

					RBXAvatar.applyMesh(shirtmesh, mesh)
					RBXAvatar.applyMesh(pantsmesh, mesh)
				}),
			)
		}

		override afterComposite() {
			this.context.drawImage(this.sources.tshirt.getImage(), 2, 74, 128, 128)
		}
	}

	class R15LimbComposite extends CompositeTexture {
		[key: string]: any

		constructor(source: CompositeSource, meshUrl: string) {
			super(264, 284)

			this.camera = new THREE.OrthographicCamera(
				-this.width / 2,
				this.width / 2,
				this.height / 2,
				-this.height / 2,
				0.1,
				100,
			)
			this.camera.position.set(this.width / 2, this.height / 2, 10)
			this.camera.rotation.set(0, 0, 0)
			this.camera.updateProjectionMatrix()

			const obj = new THREE.Mesh(
				undefined,
				new THREE.MeshBasicMaterial({
					transparent: true,
				}),
			)
			obj.frustumCulled = false
			this.scene.add(obj)

			applySourceToMaterial(source, obj.material)
			source.onUpdate(() => this.requestUpdate())

			this.loaders.push(
				AssetCache.loadMesh(
					true,
					meshUrl,
					(mesh: Mesh | null) => mesh && RBXAvatar.applyMesh(obj, mesh),
				),
			)
		}
	}

	class R15LeftArmComposite extends R15LimbComposite {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(
				sources.shirt,
				RBXAvatar.LocalAssets["res/previewer/compositing/R15CompositLeftArmBase.mesh"],
			)
		}
	}
	class R15RightArmComposite extends R15LimbComposite {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(
				sources.shirt,
				RBXAvatar.LocalAssets["res/previewer/compositing/R15CompositRightArmBase.mesh"],
			)
		}
	}
	class R15LeftLegComposite extends R15LimbComposite {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(
				sources.pants,
				RBXAvatar.LocalAssets["res/previewer/compositing/R15CompositLeftArmBase.mesh"],
			)
		}
	}
	class R15RightLegComposite extends R15LimbComposite {
		[key: string]: any

		constructor(sources: CompositeSources) {
			super(
				sources.pants,
				RBXAvatar.LocalAssets["res/previewer/compositing/R15CompositRightArmBase.mesh"],
			)
		}
	}

	return {
		CompositeTexture,
		R6Composite,

		R15TorsoComposite,
		R15LeftArmComposite,
		R15RightArmComposite,
		R15LeftLegComposite,
		R15RightLegComposite,
	}
})()
