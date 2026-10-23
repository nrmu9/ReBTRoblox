import { STORAGE } from "@/core/env"
import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"
import { toastArea } from "@/feat/toasts"
import { leave } from "@/core/leave"

// A card on Roblox pages after an update, listing what is new since the
// version updated from. Notes are written per release, newest first; a
// release with nothing worth telling has none and shows no card.

interface Note {
	title: string
	text: string
	/** The settings page it is found on, which the card can open. */
	page?: string
}

const NOTES: Array<{ version: string; notes: Note[] }> = [
	{
		version: "4.5.0",
		notes: [
			{
				title: "Activity panel",
				text: "There's a new panel with everything ReBTRoblox has recorded in one place: what changed lately, the people you watch, and the games and communities you track. Anything in it can be checked right away with Check now. You can add a link to it in the sidebar under Navigation, and start watching someone from the ... menu on their profile.",
			},
			{
				title: "Charts",
				text: "Activity charts can be zoomed by dragging across them, switched to a per-day view, and saved as a CSV. They also mark game updates and community shouts. Tracked games now keep favorites and likes too, and a person's stats show how long they're online each day and when they're usually on.",
			},
			{
				title: "Live game pages",
				text: "The player count, visits and likes on a game page update while you're looking at it. The page also shows how long you've played the game and which servers you were in recently.",
			},
			{
				title: "Chat search",
				text: "Chats have a search button. It goes through the whole conversation, and clicking a result scrolls back to that message.",
			},
			{
				title: "Your own layout",
				text: "Drag top bar and sidebar items to reorder them, and hide the ones you don't use, Roblox's featured game included. Home can hide its banner and the friends row. It's all under Navigation and Home in the settings.",
			},
			{
				title: "Unfriend and unfollow from your lists",
				text: "Every entry in your friends, following and communities lists has a ... button to unfriend, unfollow or leave without opening the page. It asks before doing anything.",
			},
			{
				title: "Avatar previews",
				text: "Item previews show particles, fire, sparkles and lights, and they load faster.",
			},
			{
				title: "Settings sync",
				text: "Your settings sync through your Firefox or Chrome account, so they carry over to your other computers and come back after a reinstall. There's also a backup that saves your settings and recorded activity to a file.",
				page: "backup",
			},
			{
				title: "Fixes",
				text: "Chats that only showed the latest message, or got stuck sending, load properly. The friend log says who ended a friend request or friendship. Server sorts like Best latency work with the paged server list, weekday names are fixed, and profiles of people who blocked you load and tell you so. When Roblox says it's getting too many requests, ReBTRoblox waits instead of asking again. Item previews and community pages work properly on Chrome.",
			},
		],
	},
]

const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0)

/** Negative if a is older than b, positive if newer. */
const compare = (a: string, b: string) => {
	const [x, y] = [parts(a), parts(b)]

	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const diff = (x[i] ?? 0) - (y[i] ?? 0)
		if (diff) {
			return diff
		}
	}

	return 0
}

/** The notes of every release after `from`, up to and including `to`, newest first. */
const notesBetween = (from: string, to: string) =>
	NOTES.filter((release) => compare(release.version, from) > 0 && compare(release.version, to) <= 0)

interface Pending {
	from: string
	to: string
}

/**
 * Remembers an update for the pages to tell about. Several updates before a
 * page is seen keep the oldest version, so the card covers all of them.
 */
export const recordUpdate = (details: chrome.runtime.InstalledDetails): void => {
	const to = chrome.runtime.getManifest().version

	if (
		details.reason !== "update" ||
		!details.previousVersion ||
		compare(to, details.previousVersion) <= 0
	) {
		return
	}

	STORAGE.get("whatsNew", (data) => {
		const pending = data.whatsNew as Pending | undefined
		const from =
			pending && compare(pending.from, details.previousVersion!) < 0
				? pending.from
				: details.previousVersion!

		STORAGE.set({ whatsNew: { from, to } })
	})
}

let card: HTMLElement | null = null

/** Shows the notes of `releases`, newest first, until closed. */
const showReleases = (releases: typeof NOTES, onDismiss?: () => void): void => {
	card?.remove()
	card = null

	if (!releases.length) {
		return
	}

	const newest = releases[0].version
	card = html`<div class="btr-whatsnew" role="dialog" aria-labelledby="btr-whatsnew-title">
		<div class="btr-whatsnew-head">
			<span class="btr-whatsnew-heading">
				<span class="btr-whatsnew-badge">New</span>
				<strong id="btr-whatsnew-title">ReBTRoblox ${newest}</strong>
			</span>
			<button type="button" class="btr-whatsnew-close" aria-label="Close">
				<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
					<path
						d="M6 6l12 12M18 6L6 18"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
		<div class="btr-whatsnew-body"></div>
		<div class="btr-whatsnew-actions">
			<button type="button" class="btr-whatsnew-done">Got it</button>
		</div>
	</div>`

	const body = card.$req(".btr-whatsnew-body")

	for (const release of releases) {
		if (releases.length > 1) {
			body.append(html`<div class="btr-whatsnew-version">${release.version}</div>`)
		}

		const list = html`<ul class="btr-whatsnew-list"></ul>`

		for (const note of release.notes) {
			const item = html`<li>
				<strong>${note.title}</strong>
				<span>${note.text}</span>
			</li>`

			const page = note.page

			if (page) {
				const open = html`<button type="button" class="btr-whatsnew-open">Open in settings</button>`
				open.$on("click", () => {
					document.dispatchEvent(new CustomEvent("btr-open-settings", { detail: page }))
				})
				item.append(open)
			}

			list.append(item)
		}

		body.append(list)
	}

	const close = () => {
		leave(card)
		card = null
		onDismiss?.()
	}

	card.$req(".btr-whatsnew-close").$on("click", close)
	card.$req(".btr-whatsnew-done").$on("click", close)

	toastArea().prepend(card)
}

/** The newest notes up to this version, for the settings to show again. */
export const showCurrentNotes = (): void => {
	const version = chrome.runtime.getManifest().version
	const current = NOTES.find((release) => compare(release.version, version) <= 0)

	if (current) {
		showReleases([current])
	}
}

/** Shows the card after an update until it is dismissed, on any open Roblox page. */
export const watchWhatsNew = (): void => {
	const read = () =>
		STORAGE.get("whatsNew", (data) => {
			const pending = data.whatsNew as Pending | undefined

			if (!pending || !SETTINGS.get("general.whatsNew")) {
				leave(card)
				card = null
				return
			}

			showReleases(notesBetween(pending.from, pending.to), () => STORAGE.remove("whatsNew"))
		})

	// Dismissed on one tab, gone from the others.
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local" && changes.whatsNew) {
			read()
		}
	})

	SETTINGS.onChange("general.whatsNew", read)
	document.$watch("body", read)

	// Dev builds: btrWhatsNew() in the page console shows the newest notes,
	// btrWhatsNew("4.3.0") everything since that version. Nothing is stored.
	if (__DEV__) {
		injectScript.listen("devWhatsNew", (from: unknown) => {
			showReleases(typeof from === "string" ? notesBetween(from, NOTES[0].version) : NOTES.slice(0, 1))
		})
	}
}
