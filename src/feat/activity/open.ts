import type { TrackedKind } from "@/feat/activity/trackDialog"

// The activity dialogs and their charts are only needed once one is opened,
// so pages that offer them load them then.

export const openActivity = (...args: Parameters<typeof import("@/feat/activity/dialog").openActivity>) =>
	import("@/feat/activity/dialog").then((module) => module.openActivity(...args))

export const openTracked = (kind: TrackedKind, id: number, name: string): void =>
	void import("@/feat/activity/trackDialog").then((module) => module.openTracked(kind, id, name))
