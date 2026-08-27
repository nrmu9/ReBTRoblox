import { AssetCache } from "@/rbx/AssetCache"
import type { CFrameTuple } from "@/rbx/types"
import { RBXAvatar } from "@/rbx/Avatar/Avatar"

export const RBXAvatarRigs = (() => {
	const RecurseTree = (model: any) => {
		const parts: Record<string, any> = {}

		const recursePart = (part: any) => {
			if (part.Name in parts) {
				return parts[part.Name]
			}

			const partData = <Record<string, any>>{
				name: part.Name,
				children: [],
				attachments: {},
				origSize: [...(part.size || part.Size)],
			}

			parts[part.Name] = partData

			for (const item of part.Children) {
				if (item.ClassName === "Attachment" && !item.Name.endsWith("RigAttachment")) {
					partData.attachments[item.Name] = RBXAvatar.CFrameToMatrix4(
						...(item.CFrame as CFrameTuple),
					)
				} else if (item.ClassName === "WrapTarget") {
					partData.wrapTarget = {
						cageMeshId: item.CageMeshId ?? "",
						cageOrigin: RBXAvatar.CFrameToMatrix4(...(item.CageOrigin as CFrameTuple)),
						stiffness: item.Stiffness ?? 0,
					}
				} else if (item.ClassName === "Motor6D") {
					const part0Data = recursePart(item.Part0)
					const part1Data = recursePart(item.Part1)

					part1Data.JointName = item.Name
					part1Data.C0 = RBXAvatar.CFrameToMatrix4(...(item.C0 as CFrameTuple))
					part1Data.C1 = RBXAvatar.CFrameToMatrix4(...(item.C1 as CFrameTuple))

					part0Data.children.push(part1Data)

					if (item.Name === "Root" || item.Name === "Neck") {
						part0Data.attachments[`${item.Name}RigAttachment`] = RBXAvatar.CFrameToMatrix4(
							...(item.C0 as CFrameTuple),
						)
					} else {
						part1Data.attachments[`${item.Name}RigAttachment`] = RBXAvatar.CFrameToMatrix4(
							...(item.C1 as CFrameTuple),
						)
					}
				}
			}

			if (part.ClassName === "MeshPart") {
				partData.meshId = part.MeshID ?? part.MeshId
			} else if (part.Name === "Head") {
				partData.meshId = RBXAvatar.LocalAssets[`res/previewer/heads/head.mesh`]
			} else if (RBXAvatar.R6BodyPartNames.indexOf(part.Name) !== -1) {
				const fname = part.Name.toLowerCase().replace(/\s/g, "")
				partData.meshId = RBXAvatar.LocalAssets[`res/previewer/meshes/${fname}.mesh`]
			}

			return partData
		}

		for (const item of model.Children) {
			if (item.ClassName === "Part" || item.ClassName === "MeshPart") {
				recursePart(item)
			}
		}

		return parts.HumanoidRootPart
	}

	return {
		R6Tree: null as any,
		R15Tree: null as any,

		loadPromise: null as any,
		loaded: false,

		load() {
			if (this.loadPromise) {
				return this.loadPromise
			}

			return (this.loadPromise =
				this.loadPromise ||
				new Promise<void>((resolve) => {
					const path = RBXAvatar.LocalAssets["res/previewer/characterModels.rbxm"]

					AssetCache.loadModel(true, path, (model: any[]) => {
						this.R6Tree = RecurseTree(model.find((x: any) => x.Name === "R6"))
						this.R15Tree = RecurseTree(model.find((x: any) => x.Name === "R15"))

						this.loaded = true
						resolve()
					})
				}))
		},
	}
})()
