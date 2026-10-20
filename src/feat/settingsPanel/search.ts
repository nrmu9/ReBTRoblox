import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The search box in the sidebar.

// Search, over every row's label and description and its page's name.
export const setupSearch = (modal: SettingsModalState) => {
	const input = modal.settingsDiv.$req(".btr-settings-search input") as HTMLInputElement
	const empty = modal.settingsDiv.$req(".btr-settings-empty")
	const main = modal.settingsDiv.$req(".btr-settings")

	const clear = modal.settingsDiv.$req(".btr-settings-search-clear")

	const run = () => {
		clear.hidden = !input.value
		const words = input.value.toLowerCase().split(/\s+/).filter(Boolean)
		modal.searching = words.length > 0
		main.classList.toggle("btr-settings-searching", modal.searching)

		let any = false

		for (const page of Object.values(modal.contentDivs) as HTMLElement[]) {
			let pageHits = 0

			for (const row of page.$findAll<HTMLElement>(".btr-setting-row")) {
				const text =
					`${row.textContent} ${row.dataset.search ?? ""} ${row.dataset.path ?? ""} ${page.dataset.label}`.toLowerCase()
				const hit = !modal.searching || words.every((word) => text.includes(word))

				row.classList.toggle("btr-setting-filtered", !hit)
				pageHits += hit ? 1 : 0
			}

			for (const card of page.$findAll<HTMLElement>(".btr-setting-card")) {
				card.classList.toggle(
					"btr-setting-filtered",
					modal.searching && !card.querySelector(".btr-setting-row:not(.btr-setting-filtered)"),
				)
			}

			page.classList.toggle("btr-page-hit", modal.searching && pageHits > 0)
			any ||= pageHits > 0
		}

		empty.hidden = !modal.searching || any
		modal.settingsDiv.$req(".btr-settings-title").textContent = modal.searching
			? "Search"
			: (modal.contentDivs[modal.currentContent]?.dataset.label ?? "")
	}

	input.$on("input", run)

	clear.$on("click", (ev: Event) => {
		ev.preventDefault()
		input.value = ""
		run()
		input.focus()
	})

	modal.clearSearch = () => {
		if (input.value) {
			input.value = ""
			run()
		}
	}
}
