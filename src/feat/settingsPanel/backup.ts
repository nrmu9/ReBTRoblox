import { exportBackup, importBackup, readBackup, type Backup } from "@/feat/activity/data"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// Backups: the Activity page's import of recorded activity, and the Backup
// page's backup of everything, settings with activity.

const count = (value: number) => value.toLocaleString("en-US")

/** What a backup holds, in a line: its settings, entries, the time they cover, and its lists. */
const describeBackup = (backup: Backup, full: boolean) => {
	const entries = backup.presence.length + backup.events.length
	const span =
		backup.from && backup.to
			? ` from ${new Date(backup.from).$format("MMM D, YYYY")} to ${new Date(backup.to).$format("MMM D, YYYY")}`
			: ""
	const watched = backup.lists.watchedUsers?.length ?? 0
	const tracked = (backup.lists.trackedGames?.length ?? 0) + (backup.lists.trackedGroups?.length ?? 0)
	const lists = [
		watched ? `${watched} watched ${watched === 1 ? "person" : "people"}` : "",
		tracked ? `${tracked} tracked` : "",
	].filter(Boolean)
	const settings = full ? (backup.settings ? "Settings and " : "No settings, only ") : ""

	return `${settings}${count(entries)} entries${span}${lists.length ? `, with ${lists.join(" and ")}` : ""}`
}

/** Pick a file, see what it holds, then add it. A full one restores settings too. */
export const setupImport = (options: {
	text: HTMLElement
	button: HTMLButtonElement
	cancel: HTMLButtonElement
	input: HTMLInputElement
	full: boolean
	onDone?: () => unknown
}) => {
	const { text, button, cancel, input, full } = options
	const defaultText = text.textContent
	const idle = button.textContent?.trim() ?? "Import"
	let pending: Backup | null = null

	const reset = (message = defaultText) => {
		pending = null
		text.textContent = message
		button.textContent = idle
		button.disabled = false
		cancel.hidden = true
	}

	input.$on("change", async () => {
		const file = input.files?.[0]
		input.value = ""

		if (!file) {
			return
		}

		text.textContent = "Reading the file..."

		try {
			pending = await readBackup(file)
			const entries = pending.presence.length + pending.events.length
			text.textContent = full
				? `${describeBackup(pending, true)}. Settings are replaced, activity already here is kept.`
				: `${describeBackup(pending, false)}. Entries already here are skipped.`
			button.textContent = full ? "Restore" : `Add ${count(entries)}`
			cancel.hidden = false
		} catch (err) {
			reset((err as Error).message)
		}
	})

	cancel.$on("click", () => reset())

	button.$on("click", async () => {
		if (!pending) {
			input.click()
			return
		}

		const backup = pending
		button.disabled = true
		cancel.hidden = true

		try {
			const result = await importBackup(
				backup,
				(share) => {
					button.textContent = `${Math.round(share * 100)}%`
				},
				{ settings: full },
			)

			reset(
				[
					full && backup.settings
						? `Restored ${result.settingsChanged} ${result.settingsChanged === 1 ? "setting" : "settings"}`
						: "",
					`added ${count(result.added)} entries`,
					result.skipped ? `skipped ${count(result.skipped)} already here` : "",
					result.invalid ? `${count(result.invalid)} couldn't be read` : "",
				]
					.filter(Boolean)
					.join(", ")
					.replace(/^./, (first) => first.toUpperCase()) +
					(full && result.settingsChanged ? ". Reload Roblox pages for all of them to apply." : ""),
			)
		} catch (err) {
			reset(`Couldn't import: ${(err as Error).message}`)
		}

		void options.onDone?.()
	})
}

/** The Backup page's backup of everything, and restoring one. */
export const setupBackup = (modal: SettingsModalState) => {
	const page: HTMLElement = modal.contentDivs.backup
	const text = page.$req(".btr-backup-export-text")
	const defaultText = text.textContent

	page.$req(".btr-backup-export").$on("click", async () => {
		try {
			const link = document.createElement("a")
			link.href = URL.createObjectURL(await exportBackup(true))
			link.download = `rebtroblox-backup-${new Date().$format("YYYY-MM-DD")}.json`
			link.click()
			setTimeout(() => URL.revokeObjectURL(link.href), 60e3)
			text.textContent = defaultText
		} catch (err) {
			text.textContent = `Couldn't back up: ${(err as Error).message}`
		}
	})

	setupImport({
		text: page.$req(".btr-backup-import-text"),
		button: page.$req(".btr-backup-import"),
		cancel: page.$req(".btr-backup-import-cancel"),
		input: page.$req(".btr-backup-import-file"),
		full: true,
		onDone: () => modal.refreshActivity?.(),
	})
}
