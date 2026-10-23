import { STORAGE } from "@/core/env"
import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"
import { toastArea } from "@/feat/toasts"

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
				title: "Activity in one place",
				text: "A new activity panel shows what changed lately for everyone you watch and everything you track. Watch someone from the ... menu on their profile, check anyone right away with Check now, and turn on its sidebar link under Navigation.",
			},
			{
				title: "Better charts, more to track",
				text: "Charts can zoom in, show each day, mark game updates and shouts, and save a CSV. Tracked games also record favorites and likes, and people show their time online per day and the hours they are usually on.",
			},
			{
				title: "Live game pages",
				text: "Players, visits and likes update live while the page is open, with visits counting up as they come in. Each game also shows how long you have played it and the servers you joined recently.",
			},
			{
				title: "Search your chats",
				text: "A search button in each chat finds older messages and jumps to them.",
			},
			{
				title: "Arrange the top bar, sidebar and Home",
				text: "Drag top bar and sidebar items into any order and hide the ones you never use, under Navigation. Home can hide its banners and friends strip.",
			},
			{
				title: "Remove from your lists",
				text: "Hover a friend, someone you follow, or a community in your lists for a ... menu to unfriend, unfollow or leave. It asks first.",
			},
			{
				title: "Livelier avatar previews",
				text: "Accessories show their particles, fire, sparkles and lights, and previews load faster and more reliably.",
			},
			{
				title: "Sync and back up",
				text: "Your settings follow your Firefox or Chrome account to your other computers. Settings and all recorded activity can also be saved to one file and restored on another browser.",
				page: "backup",
			},
			{
				title: "Fixes",
				text: "Chats no longer get stuck sending or show only the newest message, the friend log says who ended a request or friendship, server sorts work with the pager, weekday names are right again, and profiles of people who blocked you load and say so. When Roblox asks ReBTRoblox to slow down, it now waits.",
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
		card?.remove()
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
				card?.remove()
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
