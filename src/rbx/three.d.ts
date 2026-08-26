// Roblox data attached to three.js objects.
//
// The avatar renderer hangs its own state off three instances rather than
// wrapping them, so the types are augmented instead of cast at every use.

import "three"

declare module "three" {
	interface SkinnedMesh {
		rbxMesh?: any
		rbxMeshLoading?: any
		rbxBones?: any
		rbxScaleMod?: any
		matrixNoScale?: any
		layeredMatrix?: any
		skinnedNoScale?: any
		skinnedPoseMatrix?: any
	}

	interface Skeleton {
		btr_apply?: any
	}
}
