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

export const formatBytes = (bytes: number): string =>
	bytes >= 1024 ** 3
		? `${oneDecimal(bytes / 1024 ** 3)} GB`
		: bytes >= 1024 ** 2
			? `${oneDecimal(bytes / 1024 ** 2)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`
