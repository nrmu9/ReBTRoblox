import { html } from "@/core/html"
import { isTracked, openTracked, type TrackedKind } from "@/feat/activity/trackDialog"
import { SETTINGS } from "@/feat/settings"

// The button on game and community pages that opens their activity, where
// tracking starts and stops. It says which it will show.

export const trackButton = (kind: TrackedKind, id: number, getName: () => string): HTMLButtonElement => {
	const button = html<HTMLButtonElement>`<button type="button" class="btr-track-button"></button>`

	const update = () => {
		button.textContent = isTracked(kind, id) ? "View activity" : "Track activity"
	}

	button.$on("click", () => openTracked(kind, id, getName()))
	SETTINGS.onChange(kind === "game" ? "profile.trackedGames" : "profile.trackedGroups", update)
	update()

	return button
}
