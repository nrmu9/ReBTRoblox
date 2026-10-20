import { btrLocalStorage } from "@/core/storage"

// Roblox no longer says when someone was last online, so this remembers when
// ReBTRoblox last saw each user online, from the presence it asks Roblox for
// anyway. It is only what this device has seen, which the profile says.

const KEY = "lastSeenOnline"
const LIMIT = 3000

interface Seen {
	/** Epoch ms. */
	at: number
	/** Where Roblox said they were, such as a game name. */
	location?: string
}

const read = (): Record<string, Seen> => btrLocalStorage.getItem<Record<string, Seen>>(KEY) ?? {}

/** Records everyone in a presence response who is online, in a game or in Studio. */
export const recordPresences = (presences: any[]): void => {
	const online = presences.filter((presence) => presence?.userId && presence.userPresenceType > 0)

	if (!online.length) {
		return
	}

	const seen = read()
	const now = Date.now()

	for (const presence of online) {
		seen[presence.userId] = {
			at: now,
			location: presence.userPresenceType === 2 ? presence.lastLocation || undefined : undefined,
		}
	}

	// The oldest go first once there are too many to keep.
	const entries = Object.entries(seen)

	if (entries.length > LIMIT) {
		entries.sort(([, a], [, b]) => b.at - a.at)
		btrLocalStorage.setItem(KEY, Object.fromEntries(entries.slice(0, LIMIT)))
	} else {
		btrLocalStorage.setItem(KEY, seen)
	}
}

export const getLastSeen = (userId: number): Seen | null => read()[userId] ?? null
