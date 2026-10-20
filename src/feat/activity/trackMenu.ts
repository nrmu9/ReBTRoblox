import { isTracked, type TrackedKind } from "@/feat/activity/trackDialog"
import { SETTINGS } from "@/feat/settings"

// The menu entry on game and community pages that opens their activity, where
// tracking starts and stops. It says which it will show.

export const trackLabel = (kind: TrackedKind, id: number): string =>
	isTracked(kind, id) ? "View activity" : "Track activity"

/** Keeps `element`'s text to the label, as tracking starts and stops. */
export const keepTrackLabel = (element: HTMLElement, kind: TrackedKind, id: number): void => {
	const update = () => {
		element.textContent = trackLabel(kind, id)
	}

	SETTINGS.onChange(kind === "game" ? "profile.trackedGames" : "profile.trackedGroups", update)
	update()
}
