import { backgroundScript } from "@/core/messaging"
import type { ActivityEvent, ActivityUsage } from "@/feat/activityStore"

// The page side of the activity database, which only the background opens.

const ask = <T>(name: string, data?: unknown): Promise<T> =>
	new Promise((resolve) => backgroundScript.send(name, data ?? null, resolve))

export const getActivityUsage = () => ask<ActivityUsage | null>("activityUsage")

/** Everything last seen before `before`, or all of it with null. */
export const clearActivityBefore = (before: number | null) => ask<boolean>("activityClear", before)

export const clearUserActivity = (userId: number) => ask<boolean>("activityClearUser", userId)

export const exportActivity = () => ask<unknown>("activityExport")

export const getActivityEvents = (userId: number, kinds?: ActivityEvent["kind"][]) =>
	ask<ActivityEvent[] | null>("activityEvents", { userId, kinds })

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
