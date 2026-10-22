// What a friend request event does to the log, from what was known before.
// Roblox can send the same event twice, and the first look at a request can
// get its direction wrong when Roblox's list lags the event.

export type RequestDirection = "received" | "sent"

/** Log it the first time, put the earlier entry right if it was the other way round, or leave it. */
export const requestStep = (
	before: RequestDirection | undefined,
	now: RequestDirection,
): "log" | "correct" | "skip" => (!before ? "log" : before !== now ? "correct" : "skip")
