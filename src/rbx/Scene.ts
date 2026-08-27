import * as THREE from "three"
import { RBXAvatar } from "@/rbx/Avatar/Avatar"
import { EventEmitter } from "@/rbx/EventEmitter"
import { IS_DEV_MODE } from "@/core/env"

/**
 * three r155 reinterpreted light intensity in physical units and r165 removed
 * the useLegacyLights escape hatch, so the intensities have to be restated.
 * PI is the compensation three documents for the change. Raise this to brighten
 * the previewer overall; it scales every light in the scene together, so the
 * balance between them is preserved.
 */
const LIGHT_COMPENSATION = Math.PI

export const RBXScene = (() => {
	class Scene extends EventEmitter {
		[key: string]: any

		constructor() {
			super()
			this._prevRes = { width: -1, height: -1 }
			this.cameraControlsEnabled = true

			this.cameraMinZoom = 2
			this.cameraMaxZoom = 25
			this.cameraZoom = 10
			this.cameraSlide = 0
			this.cameraSlideEnabled = true
			this.cameraFocus = new THREE.Vector3(0, 4, 0)
			this.cameraOffset = new THREE.Vector3(0, 0, 0)
			this.cameraRotation = new THREE.Euler(0.05, 0, 0, "YXZ")
			this.cameraDir = new THREE.Vector3(0, 0, 1)
			this.prevDragEvent = null
			this.isDragging = false

			const renderer = (this.renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
			}))

			// r145 rendered with LinearEncoding output; r152 changed the default to
			// sRGB, which washes the avatar out because the colours and textures are
			// already in the space this previewer expects.
			renderer.outputColorSpace = THREE.LinearSRGBColorSpace
			renderer.setClearAlpha(0)
			renderer.shadowMap.enabled = true
			// PCFSoftShadowMap is deprecated: WebGLShadowMap warns and silently swaps
			// in PCFShadowMap, whose edges alias badly here. VSM is the only soft
			// path left, and it blurs the shadow map rather than the lookup, so the
			// penumbra stays smooth at any zoom.
			renderer.shadowMap.type = THREE.VSMShadowMap

			const canvas = (this.canvas = renderer.domElement)
			canvas.style = `
			user-select: none !important;
			-moz-user-select: none !important;
		
			position: absolute !important;
			left: 0 !important;
			right: 0 !important;
			top: 0 !important;
			bottom: 0 !important;
			width: 100% !important;
			height: 100% !important;`

			const scene = (this.scene = new THREE.Scene())
			this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100)

			const ambientLight = new THREE.AmbientLight(0x7f7f7f, LIGHT_COMPENSATION)
			scene.add(ambientLight)

			const sunLight = new THREE.DirectionalLight(0xacacac, LIGHT_COMPENSATION)
			sunLight.position.set(-0.474891931, 0.822536945, 0.312906593).multiplyScalar(15)
			sunLight.castShadow = true
			// The shadow camera spans 16 units, so 256 gave a texel every 0.06 units
			// and the avatar cast a shapeless blob. 1024 resolves the silhouette;
			// 2048 was indistinguishable at the sizes this canvas is displayed at.
			sunLight.shadow.mapSize.width = 1024
			sunLight.shadow.mapSize.height = 1024
			sunLight.shadow.radius = 2
			// VSM also renders receiveShadow objects into the depth map, so the
			// ground plane shadows itself into acne without this.
			sunLight.shadow.normalBias = 0.05
			sunLight.shadow.camera.left = -8
			sunLight.shadow.camera.right = 8
			sunLight.shadow.camera.bottom = -8
			sunLight.shadow.camera.top = 8
			sunLight.shadow.camera.near = 1
			sunLight.shadow.camera.far = 22
			scene.add(sunLight)

			const light2 = new THREE.DirectionalLight(0x444444, LIGHT_COMPENSATION)
			light2.position.copy(sunLight.position).negate()
			light2.castShadow = false
			scene.add(light2)

			this.listeners = [
				{
					target: canvas,
					events: {
						mousedown: (event: any) => {
							if (!this.cameraControlsEnabled) {
								return
							}

							if (!this.isDragging && event.button >= 0 && event.button <= 2) {
								this.prevDragEvent = event
								this.isDragging = true
								this.dragButton = event.button
							}

							if (document.activeElement) {
								;(document.activeElement as HTMLElement | null)?.blur()
							}

							event.preventDefault()
						},
						contextmenu: (event: any) => {
							if (!this.cameraControlsEnabled) {
								return
							}
							event.preventDefault()
						},
						wheel: (event: any) => {
							if (!this.cameraControlsEnabled) {
								return
							}

							const deltaY = event.deltaY

							if (deltaY > 0) {
								this.cameraZoom = Math.min(this.cameraMaxZoom, this.cameraZoom + 1)
							} else if (deltaY < 0) {
								this.cameraZoom = Math.max(this.cameraMinZoom, this.cameraZoom - 1)
							}

							event.preventDefault()
						},
					},
				},
				{
					target: window,
					events: {
						mousemove: (event: any) => {
							if (!this.cameraControlsEnabled) {
								return
							}

							if (!this.isDragging) {
								return
							}
							const moveX = event.clientX - this.prevDragEvent.clientX
							const moveY = event.clientY - this.prevDragEvent.clientY
							this.prevDragEvent = event

							if (this.dragButton === 1) {
								this.cameraSlide += (this.cameraZoom * moveY) / this.canvas.clientHeight
							} else {
								const rotX =
									this.cameraRotation.x + (2 * Math.PI * moveY) / this.canvas.clientHeight
								this.cameraRotation.x = Math.max(-1.4, Math.min(1.4, rotX))
								this.cameraRotation.y -= (2 * Math.PI * moveX) / this.canvas.clientWidth
							}
						},
						mouseup: (event: any) => {
							if (this.isDragging && event.button === this.dragButton) {
								this.isDragging = false
							}
						},
						contextmenu: (event: any) => {
							if (!this.cameraControlsEnabled) {
								return
							}

							if (event.button === 2 && event.button === this.dragButton) {
								this.dragButton = null
								event.preventDefault()
							}
						},
					},
				},
			]

			for (const listener of this.listeners) {
				for (const params of Object.entries(listener.events)) {
					listener.target.addEventListener(...params)
				}
			}
		}

		update() {
			const parent = this.canvas.parentNode
			if (parent) {
				const width = parent.clientWidth
				const height = parent.clientHeight
				const res = this._prevRes

				if (width !== res.width || height !== res.height) {
					res.width = width
					res.height = height

					this.renderer.setSize(width, height, false)
					this.camera.aspect = height === 0 ? 0 : width / height
					this.camera.updateProjectionMatrix()
				}
			}

			this.cameraDir.set(0, 0, 1).applyEuler(this.cameraRotation)

			//
			if (this.cameraSlideEnabled) {
				let minSlide = 2
				let maxSlide = 5.5

				if (this.avatar.playerType === "R15" && this.avatar.joints.LowerTorso) {
					maxSlide =
						this.avatar.hipHeight +
						this.avatar.parts.HumanoidRootPart.rbxSize[1] / 2 +
						this.avatar.joints.LowerTorso.bakedC0.elements[13] +
						this.avatar.joints.LowerTorso.bakedC1Inverse.elements[13] +
						this.avatar.joints.Head.bakedC0.elements[13] +
						this.avatar.joints.Head.bakedC1Inverse.elements[13] +
						1
				}

				minSlide -= this.cameraFocus.y + this.cameraOffset.y
				maxSlide -= this.cameraFocus.y + this.cameraOffset.y

				this.cameraSlide = Math.max(minSlide, Math.min(maxSlide, this.cameraSlide))
			}
			//

			const focus = this.cameraFocus.clone()
			focus.add(this.cameraOffset)
			focus.y += this.cameraSlide

			this.camera.position.copy(focus).addScaledVector(this.cameraDir, -this.cameraZoom)
			this.camera.lookAt(focus)

			const groundDiff = 0.2 - this.camera.position.y
			if (this.cameraDir.y > 0 && groundDiff > 0) {
				this.camera.position.addScaledVector(this.cameraDir, groundDiff / this.cameraDir.y)
			}
		}

		render() {
			this.renderer.render(this.scene, this.camera)
		}

		/** Dev only handle, so the previewer can be inspected from the bridge. */
		exposeForDebug() {
			if (!__DEV__ || !IS_DEV_MODE) {
				return
			}
			;(window as any).__btrScene = this
		}

		remove() {
			if (this.started) {
				this.stop()
			}
			this.canvas.remove()

			for (const listener of this.listeners) {
				for (const params of Object.entries(listener.events)) {
					listener.target.removeEventListener(...params)
				}
			}
		}

		start() {
			if (this.started) {
				return
			}
			this.started = true

			const innerUpdate = () => {
				this.update()
				this.render()
				this._afId = requestAnimationFrame(innerUpdate)
			}

			this._afId = requestAnimationFrame(innerUpdate)
			this.exposeForDebug()
		}

		stop() {
			if (!this.started) {
				return
			}
			this.started = false

			cancelAnimationFrame(this._afId)
			delete this._afId
		}
	}

	class AvatarScene extends Scene {
		[key: string]: any

		constructor() {
			super()

			const avatar = (this.avatar = new RBXAvatar.Avatar())
			this.scene.add(avatar.root)

			this.avatarOffset = {
				position: new THREE.Vector3(),
				rotation: new THREE.Euler(),
			}

			const stand = new THREE.Mesh(
				new THREE.CylinderGeometry(2.5, 2.5, 0.1, 48),
				new THREE.MeshLambertMaterial({ color: 0xb7a760 }),
			)
			stand.frustumCulled = false
			stand.position.y = 0.05
			stand.receiveShadow = true
			this.scene.add(stand)

			const groundMat = new THREE.ShadowMaterial()
			groundMat.opacity = 0.5

			const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat)
			ground.frustumCulled = false
			ground.rotation.x = -Math.PI / 2
			ground.position.y = 0.001
			ground.receiveShadow = true
			this.scene.add(ground)

			this.renderer.clippingPlanes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0)))
		}

		override update() {
			super.update()

			this.avatar.offset.set(0, 0.1, 0).add(this.avatarOffset.position)
			this.avatar.offsetRot.copy(this.avatarOffset.rotation)

			this.avatar.update()
			this.trigger("update")
		}

		override start() {
			super.start()

			if (!this.hasInit) {
				this.hasInit = true
				this.avatar.init()
			}
		}
	}

	return {
		Scene,
		AvatarScene,
	}
})()
