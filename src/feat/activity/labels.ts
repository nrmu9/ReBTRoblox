import type { ActivityEvent } from "@/feat/activity/store"

// How the friend log words what happened, kept apart from the log itself so the
// wording can be checked on its own.

/** What happened, read after the person's name. */
export const peopleLabel = ({ kind, field }: ActivityEvent, isOwn: boolean) =>
	({
		requestReceived: "Sent you a request",
		requestSent: "You sent a request",
		// "you" and "them" are known, a block was checked, and the rest is not
		// known. "byYou" and "byThem" were guessed from the request's direction
		// before, so an older "byYou" only says their request ended.
		requestDeclined:
			field === "you"
				? "You declined"
				: field === "them" || field === "byThem"
					? "Declined your request"
					: field === "blockedYou"
						? "Blocked you"
						: field === "blockedByYou"
							? "You blocked them"
							: field === "ended" || field === "byYou"
								? "Their request ended"
								: "Request ended",
		friendAdded:
			field === "you" ? "You accepted" : field === "them" ? "Accepted your request" : "Friend added",
		friendRemoved:
			field === "you"
				? "You unfriended"
				: field === "blockedYou"
					? "Blocked you"
					: field === "blockedByYou"
						? "You blocked them"
						: isOwn
							? "No longer friends"
							: "Friend removed",
		followerAdded: isOwn ? "Followed you" : "Followed them",
		followerRemoved: isOwn ? "Unfollowed you" : "Unfollowed them",
		followingAdded: isOwn ? "You followed" : "They followed",
		followingRemoved: isOwn ? "You unfollowed" : "They unfollowed",
	})[kind as string] ?? kind
