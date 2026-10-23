import { html } from "@/core/html"
import { bugReportUrl, clearErrorLog, errorReport, readErrorLog, type ErrorEntry } from "@/feat/errorLog"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The Recent Errors card on the Experiments page: what went wrong lately, newest
// first, with a way to copy it all for a bug report.

const SHOWN = 10

const entryRow = (entry: ErrorEntry) => {
	const row = html`<li class="btr-error-log-entry">
		<div class="btr-error-log-head">
			<span class="btr-error-log-where"></span>
			<span class="btr-error-log-when"></span>
		</div>
		<div class="btr-error-log-message"></div>
	</li>`

	row.$req(".btr-error-log-where").textContent = entry.page ? `${entry.where} · ${entry.page}` : entry.where
	row.$req(".btr-error-log-when").textContent =
		new Date(entry.at).$since() + (entry.count > 1 ? ` · ${entry.count} times` : "")
	row.$req(".btr-error-log-message").textContent = entry.message

	return row
}

export const setupErrorLog = (modal: SettingsModalState) => {
	const card: HTMLElement | null = modal.contentDivs.advanced?.$find(".btr-error-log") ?? null

	if (!card) {
		return
	}

	const summary = card.$req(".btr-error-log-summary")
	const list = card.$req(".btr-error-log-list")
	const copy = card.$req<HTMLButtonElement>(".btr-error-log-copy")
	const clear = card.$req<HTMLButtonElement>(".btr-error-log-clear")
	const report = card.$req<HTMLButtonElement>(".btr-error-log-report")
	let log: ErrorEntry[] = []

	const render = async () => {
		log = await readErrorLog()

		const total = log.reduce((sum, entry) => sum + entry.count, 0)
		summary.textContent = total ? `${total} error${total === 1 ? "" : "s"} lately` : "No errors"
		copy.disabled = clear.disabled = !log.length

		list.replaceChildren(...log.toReversed().slice(0, SHOWN).map(entryRow))
		list.hidden = !log.length
	}

	copy.$on("click", async () => {
		try {
			await navigator.clipboard.writeText(errorReport(log))
			copy.textContent = "Copied"
		} catch {
			copy.textContent = "Could not copy"
		}

		setTimeout(() => (copy.textContent = "Copy report"), 2000)
	})

	report.$on("click", async () => {
		// Copied before the new tab takes focus, which the clipboard needs.
		if (log.length) {
			await navigator.clipboard.writeText(errorReport(log)).catch(() => {})
		}

		window.open(
			bugReportUrl(chrome.runtime.getManifest().version, navigator.userAgent),
			"_blank",
			"noopener",
		)
	})

	clear.$on("click", () => clearErrorLog())

	const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		if (area === "local" && changes.errorLog) {
			void render()
		}
	}

	chrome.storage.onChanged.addListener(onChanged)
	void render()
}
