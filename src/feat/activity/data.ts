import { backgroundScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"
import type { ActivityEvent, ActivityUsage } from "@/feat/activity/store"

// The page side of the activity database, which only the background opens.

const ask = <T>(name: string, data?: unknown): Promise<T> =>
	new Promise((resolve) => backgroundScript.send(name, data ?? null, resolve))

export const getActivityUsage = () => ask<ActivityUsage | null>("activityUsage")

/** Everything last seen before `before`, or all of it with null. */
export const clearActivityBefore = (before: number | null) => ask<boolean>("activityClear", before)

export const clearUserActivity = (userId: number) => ask<boolean>("activityClearUser", userId)

// Who is watched and what is tracked, which a backup carries with the activity.
const LISTS = {
	watchedUsers: "profile.watchedUsers",
	trackedGames: "profile.trackedGames",
	trackedGroups: "profile.trackedGroups",
} as const

const listOf = (path: string): number[] => {
	try {
		const list = JSON.parse(SETTINGS.get(path) || "[]")
		return Array.isArray(list) ? list.filter((id) => Number.isSafeInteger(id)) : []
	} catch {
		return []
	}
}

/**
 * Everything recorded, and who is watched and tracked, as a JSON file built a
 * page of records at a time. A full backup carries every setting as well.
 */
export const exportBackup = async (withSettings: boolean): Promise<Blob> => {
	const lists = Object.fromEntries(Object.entries(LISTS).map(([key, path]) => [key, listOf(path)]))
	const parts: string[] = [
		`{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"lists":${JSON.stringify(lists)}`,
	]

	if (withSettings) {
		parts.push(`,"settings":${JSON.stringify(SETTINGS.serialize())}`)
	}

	for (const store of ["presence", "events"] as const) {
		parts.push(`,"${store}":[`)
		let after = 0
		let first = true

		for (;;) {
			const page = await ask<Array<{ id: number }> | null>("activityExportPage", {
				store,
				after,
				limit: 5000,
			})

			// A missing page would otherwise end the file early and look complete.
			if (!page) {
				throw new Error("Activity data could not be read")
			}

			for (const record of page) {
				parts.push((first ? "" : ",") + JSON.stringify(record))
				first = false
			}

			if (page.length < 5000) {
				break
			}

			after = page.at(-1)!.id
		}

		parts.push("]")
	}

	parts.push("}")
	return new Blob(parts, { type: "application/json" })
}

export interface WatchChecks {
	presence?: number
	friends?: number
	profile?: number
	badges?: number
	favorites?: number
	follows?: number
}

/** Whether someone is on the watched list. */
export const isWatchedUser = (userId: number): boolean => {
	try {
		const list = JSON.parse(SETTINGS.get("profile.watchedUsers") || "[]")
		return Array.isArray(list) && list.includes(userId)
	} catch {
		return false
	}
}

/** Whether a game or community is on its tracked list. */
export const isTrackedItem = (kind: "game" | "group", id: number): boolean => {
	try {
		const list = JSON.parse(
			SETTINGS.get(kind === "game" ? "profile.trackedGames" : "profile.trackedGroups") || "[]",
		)
		return Array.isArray(list) && list.includes(id)
	} catch {
		return false
	}
}

/** When each of a watched person's checks last ran. */
export const getWatchChecks = (userId: number) => ask<WatchChecks | null>("activityChecks", userId)

/** Asks for a watched person's checks to be brought up to date, as their page is open. */
export const refreshWatched = (userId: number): void => backgroundScript.send("activityRefresh", userId)

export const exportActivity = () => exportBackup(false)

export interface Backup {
	presence: unknown[]
	events: unknown[]
	lists: Partial<Record<keyof typeof LISTS, number[]>>
	/** Every setting by group and name, in a full backup. */
	settings: Record<string, Record<string, unknown>> | null
	exportedAt: string | null
	/** The oldest and newest times in it. */
	from: number | null
	to: number | null
	people: number
}

/** A backup file read and checked for its shape, or an error saying why it is not one. */
export const readBackup = async (file: File): Promise<Backup> => {
	let json: any

	try {
		json = JSON.parse(await file.text())
	} catch {
		throw new Error("That file isn't JSON")
	}

	if (!json || !Array.isArray(json.presence) || !Array.isArray(json.events)) {
		throw new Error("That file isn't a ReBTRoblox export")
	}

	const times: number[] = []
	const people = new Set<number>()

	for (const record of [...json.presence, ...json.events]) {
		const at = record?.from ?? record?.at
		if (typeof at === "number") {
			times.push(at)
		}
		if (Number.isSafeInteger(record?.userId) && record.userId > 0) {
			people.add(record.userId)
		}
	}

	const lists: Backup["lists"] = {}

	for (const key of Object.keys(LISTS) as Array<keyof typeof LISTS>) {
		const list = json.lists?.[key]
		if (Array.isArray(list)) {
			lists[key] = list.filter((id: unknown) => Number.isSafeInteger(id))
		}
	}

	const settings =
		json.settings && typeof json.settings === "object" && !Array.isArray(json.settings)
			? json.settings
			: null

	return {
		presence: json.presence,
		events: json.events,
		lists,
		settings,
		exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : null,
		from: times.length ? times.reduce((a, b) => Math.min(a, b)) : null,
		to: times.length ? times.reduce((a, b) => Math.max(a, b)) : null,
		people: people.size,
	}
}

const IMPORT_PAGE = 2000

/**
 * Sets every setting a backup has that this version knows and accepts. The
 * watched and tracked lists are left to be merged, so none are lost.
 */
const restoreSettings = (settings: Record<string, Record<string, unknown>>) => {
	const lists = new Set<string>(Object.values(LISTS))
	let changed = 0
	let ignored = 0

	for (const [group, values] of Object.entries(settings)) {
		for (const [name, value] of Object.entries(values ?? {})) {
			const path = `${group}.${name}`

			if (lists.has(path)) {
				continue
			}

			if (!SETTINGS.hasSetting(path)) {
				ignored++
				continue
			}

			try {
				if (SETTINGS.get(path) !== value) {
					SETTINGS.set(path, value)
					changed++
				}
			} catch {
				ignored++
			}
		}
	}

	return { changed, ignored }
}

/**
 * Adds a backup to what is recorded, a page at a time, and its watched and
 * tracked lists to the current ones. Nothing here is replaced.
 */
export const importBackup = async (
	backup: Backup,
	onProgress: (share: number) => void,
	options: { settings?: boolean } = {},
) => {
	const importId = `${Date.now()}-${Math.random()}`
	const total = backup.presence.length + backup.events.length
	const result = { added: 0, skipped: 0, invalid: 0, settingsChanged: 0, settingsIgnored: 0 }
	let sent = 0

	if (options.settings && backup.settings) {
		const restored = restoreSettings(backup.settings)
		result.settingsChanged = restored.changed
		result.settingsIgnored = restored.ignored
	}

	for (const store of ["presence", "events"] as const) {
		const records = backup[store]

		for (let i = 0; i < records.length; i += IMPORT_PAGE) {
			const page = await ask<typeof result | null>("activityImportPage", {
				importId,
				store,
				records: records.slice(i, i + IMPORT_PAGE),
			})

			if (!page) {
				throw new Error("The background stopped while importing")
			}

			result.added += page.added
			result.skipped += page.skipped
			result.invalid += page.invalid
			sent += Math.min(IMPORT_PAGE, records.length - i)
			onProgress(total ? sent / total : 1)
		}
	}

	for (const [key, path] of Object.entries(LISTS) as Array<[keyof typeof LISTS, string]>) {
		const incoming = backup.lists[key] ?? []
		const current = listOf(path)
		const merged = [...new Set([...current, ...incoming])]

		if (merged.length !== current.length) {
			SETTINGS.set(path, JSON.stringify(merged))
		}
	}

	return result
}

export const getActivityEvents = (userId: number, kinds?: ActivityEvent["kind"][], since?: number) =>
	ask<ActivityEvent[] | null>("activityEvents", { userId, kinds, ...(since ? { since } : {}) })

// One decimal, dropped when it is a zero: 250 MB, 12.4 MB.
const oneDecimal = (value: number) => String(Number(value.toFixed(1)))

/** Current names for user ids, asked for 100 at a time. */
export const getUserNames = async (userIds: number[]) => {
	const names = new Map<number, { name: string; displayName: string }>()

	for (let i = 0; i < userIds.length; i += 100) {
		const json = await fetch("https://users.roblox.com/v1/users", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userIds: userIds.slice(i, i + 100), excludeBannedUsers: false }),
		})
			.then((res) => res.json())
			.catch(() => null)

		for (const user of json?.data ?? []) {
			names.set(user.id, { name: user.name, displayName: user.displayName })
		}
	}

	return names
}

export const formatBytes = (bytes: number): string =>
	bytes >= 1024 ** 3
		? `${oneDecimal(bytes / 1024 ** 3)} GB`
		: bytes >= 1024 ** 2
			? `${oneDecimal(bytes / 1024 ** 2)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`

export type ForceTarget = { kind: "user" | "game" | "group"; id: number } | { kind: "all" }

export interface ForceResult {
	ok: boolean
	/** How long until it may be asked again, when it was asked too soon. */
	wait?: number
	started?: boolean
	reason?: string
}

/** Runs checks now, within the background's limits on how often. */
export const forceCheck = (target: ForceTarget) => ask<ForceResult | null>("activityForceCheck", target)

/** The newest events across everything, a page at a time, older than the last one shown. */
export const getRecentEvents = (before?: number, beforeId?: number, limit = 30) =>
	ask<Array<ActivityEvent & { id: number }> | null>("activityRecent", { before, beforeId, limit })
