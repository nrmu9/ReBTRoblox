import { isId } from "@/core/pageInput"
import { SETTINGS } from "@/feat/settings"

// Who you watch and what you track, kept in settings as JSON lists of ids.
// Everything in activity reads and changes them through here.

export const LIST_SETTINGS = {
	watched: "profile.watchedUsers",
	game: "profile.trackedGames",
	group: "profile.trackedGroups",
} as const

export type ListName = keyof typeof LIST_SETTINGS

/** The ids in a list setting; anything that is not a Roblox id is left out. */
export const idsAt = (path: string): number[] => {
	try {
		const ids = JSON.parse(SETTINGS.get(path) || "[]")
		return Array.isArray(ids) ? ids.filter(isId) : []
	} catch {
		return []
	}
}

export const listIds = (list: ListName): number[] => idsAt(LIST_SETTINGS[list])

export const onList = (list: ListName, id: number): boolean => listIds(list).includes(id)

/** Adds an id to a list or takes it off, keeping the rest in their order. */
export const setOnList = (list: ListName, id: number, on: boolean): void => {
	const ids = listIds(list).filter((other) => other !== id)
	SETTINGS.set(LIST_SETTINGS[list], JSON.stringify(on ? [...ids, id] : ids))
}
