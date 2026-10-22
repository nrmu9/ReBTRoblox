import { STORAGE } from "@/core/env"
import { html } from "@/core/html"
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
				title: "Search your chats",
				text: "A search button in each chat looks back through its history and shows each match with the messages around it.",
			},
			{
				title: "Unfriend and leave from your lists",
				text: "Hover a friend on your friends page, or a community in your communities list, to remove them from there. It asks first.",
			},
			{
				title: "Better charts",
				text: "Activity charts can show each day, zoom in by dragging, mark game updates and shouts, and show a table or save a CSV.",
			},
			{
				title: "More to track",
				text: "Tracked games now record favorites and likes. People's stats show time online per day and which hours they are usually on.",
			},
			{
				title: "Back up everything",
				text: "Save your settings and all recorded activity to one file, and restore it on another browser.",
				page: "advanced",
			},
			{
				title: "Import activity",
				text: "Add activity from an export without losing what is already recorded.",
				page: "activity",
			},
			{
				title: "Fixes",
				text: "Chat messages no longer get stuck sending, server sorts like Best latency work with the pager, and weekday names are right again.",
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
			<strong id="btr-whatsnew-title">New in ReBTRoblox ${newest}</strong>
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
}
