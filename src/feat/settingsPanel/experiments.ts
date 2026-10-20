import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { SETTINGS } from "@/feat/settings"
import { robloxExperiments } from "@/pages/common"
import { discoverExperimentHints, getExperimentPage } from "@/feat/experimentHints"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The Roblox experiment editor on the Advanced page.

// Experiment editor: a filter over experiments and parameters, and a
// reset for all of them.
export const setupExperimentToolbar = (modal: SettingsModalState) => {
	const filter = modal.settingsDiv.$req(".btr-exp-filter input") as HTMLInputElement

	filter.$on("input", () => {
		const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean)

		for (const group of Object.values(modal.experiments) as any[]) {
			const groupHit = words.every((word) => group.name.toLowerCase().includes(word))
			let shown = 0

			for (const entry of Object.values(group.entries) as any[]) {
				const hit = groupHit || words.every((word) => entry.key.toLowerCase().includes(word))
				entry.row.hidden = !hit
				shown += hit ? 1 : 0
			}

			group.details.hidden = shown === 0
		}
	})

	modal.settingsDiv.$req("#btr-exp-reset").$on("click", () => modal.resetExperiments())

	const editedOnly = modal.settingsDiv.$req("#btr-exp-edited") as HTMLButtonElement
	editedOnly.$on("click", () => {
		const on = editedOnly.getAttribute("aria-pressed") !== "true"
		editedOnly.setAttribute("aria-pressed", String(on))
		modal.settingsDiv.$req("#btr-settings-experiments").classList.toggle("btr-exp-edited-only", on)
	})
}

export const getSavedExperiments = () => {
	const data = SETTINGS.get("general.experiments")
	let saved

	try {
		saved = JSON.parse(data || "{}")
	} catch (ex) {
		console.error(ex)
	}

	return saved instanceof Object && !Array.isArray(saved) ? saved : {}
}

/** Reads Roblox's scripts for what each parameter accepts, once, when Advanced opens. */
export const loadExperimentHints = (modal: SettingsModalState) => {
	if (modal.experimentHints || modal.loadingHints || !modal.settingsDiv) {
		return
	}

	modal.loadingHints = true
	const note: HTMLElement = modal.settingsDiv.$req(".btr-exp-note")
	note.textContent = "Reading Roblox's scripts for the values each parameter accepts..."

	const keys = Object.values(modal.experiments).flatMap((group: any) => Object.keys(group.entries))

	discoverExperimentHints(keys).then(
		async (hints) => {
			// Parameters that turned up while the scripts were being read are
			// looked up too; the scripts are cached by now, so this is quick.
			const missing = Object.values(modal.experiments)
				.flatMap((group: any) => Object.keys(group.entries))
				.filter((key) => !(key in hints))

			if (missing.length) {
				Object.assign(hints, await discoverExperimentHints(missing))
			}

			modal.experimentHints = hints
			note.textContent = ""

			for (const group of Object.values(modal.experiments) as any[]) {
				for (const entry of Object.values(group.entries) as any[]) {
					entry.render()
				}
				group.sort()
			}
		},
		() => {
			modal.loadingHints = false
			note.textContent = "Couldn't read Roblox's scripts, so only typed values are offered"
		},
	)
}

export const robloxExperimentsChanged = (modal: SettingsModalState) => {
	const root: HTMLElement | null = modal.settingsDiv?.$find("#btr-settings-experiments")

	if (!root) {
		return
	}

	const format = (json: string) => {
		try {
			const value = JSON.parse(json)
			return typeof value === "string" ? value : String(value)
		} catch {
			return json
		}
	}

	const save = (experiment: string, key: string, value: string) => {
		const data = modal.getSavedExperiments()

		// Picking what is already saved is not a change.
		if ((data[experiment]?.[key] || "") === value) {
			return
		}

		injectScript.send("updateExperiment", experiment, key, value)

		if (value) {
			data[experiment] ??= {}
			data[experiment][key] = value
		} else if (data[experiment]) {
			delete data[experiment][key]

			if (Object.keys(data[experiment]).length === 0) {
				delete data[experiment]
			}
		}

		// Nothing left goes back to the default, not to "{}".
		SETTINGS.set("general.experiments", Object.keys(data).length ? JSON.stringify(data) : "")
	}

	const addGroup = (experiment: string) => {
		const details = html`<details class="btr-exp-group" open>
			<summary>
				<span class="btr-exp-title"></span>
				<span class="btr-exp-count"></span>
			</summary>
			<div class="btr-exp-rows"></div>
		</details>`

		details.$req(".btr-exp-title").textContent = experiment

		// Experiments only show up on the page that asked for them, so where
		// one came from tells you where to look for its effect.
		const page = getExperimentPage(experiment)
		if (page) {
			details.$req(".btr-exp-count").before(html`<span class="btr-exp-page">${page}</span>`)
		}
		details.title = experiment

		const group = {
			name: experiment,
			details,
			rows: details.$req(".btr-exp-rows"),
			entries: {} as Record<string, any>,

			/** Parameters the site reads first, then the rest, dimmed. */
			sort() {
				const entries = Object.values(this.entries).toSorted(
					(a: any, b: any) => Number(a.unused) - Number(b.unused) || a.key.localeCompare(b.key),
				)

				this.rows.append(...entries.map((entry: any) => entry.row))

				const edited = entries.filter((entry: any) => entry.edited).length
				const used = entries.filter((entry: any) => !entry.unused).length

				details.$req(".btr-exp-count").textContent = edited ? `${edited} edited` : ""
				details.classList.toggle("btr-exp-unused", !!modal.experimentHints && used === 0)

				const groups = Object.values(modal.experiments).toSorted(
					(a: any, b: any) =>
						Number(a.details.classList.contains("btr-exp-unused")) -
							Number(b.details.classList.contains("btr-exp-unused")) ||
						a.name.localeCompare(b.name),
				)

				root.append(...groups.map((other: any) => other.details))
			},
		}

		modal.experiments[experiment] = group
		root.append(details)
		return group
	}

	const addEntry = (group: any, key: string) => {
		const row = html`<div class="btr-exp-row">
			<span class="btr-exp-name"></span>
			<span class="btr-exp-control"></span>
		</div>`

		row.$req(".btr-exp-name").textContent = key
		row.$req(".btr-exp-name").title = key

		const entry = {
			key,
			row,
			unused: false,
			edited: false,

			render() {
				const experiment = group.name
				const hint = modal.experimentHints?.[key]
				const current = robloxExperiments[experiment]?.[key]
				const saved: string = modal.getSavedExperiments()[experiment]?.[key] || ""
				const currentJson = current === undefined ? "" : JSON.stringify(current)

				this.unused = !!hint && !hint.used
				this.edited = !!saved
				row.classList.toggle("btr-exp-unused", this.unused)
				row.classList.toggle("btr-exp-edited", this.edited)

				// Roblox's comparisons, or a boolean's two states, become a list;
				// anything else stays a typed value.
				const choices = new Set<string>(
					hint?.flag || typeof current === "boolean" ? ["true", "false"] : (hint?.values ?? []),
				)

				const slot = row.$req(".btr-exp-control")

				if (choices.size) {
					if (currentJson) {
						choices.add(currentJson)
					}
					if (saved) {
						choices.add(saved)
					}

					const select = html<HTMLSelectElement>`<select aria-label="${key}"></select>`
					const defaultOption = document.createElement("option")
					defaultOption.value = ""
					defaultOption.textContent = currentJson ? `Default (${format(currentJson)})` : "Default"
					select.append(defaultOption)

					for (const choice of choices) {
						const option = document.createElement("option")
						option.value = choice
						option.textContent = format(choice)
						select.append(option)
					}

					select.value = saved
					select.$on("change", () => {
						save(experiment, key, select.value)
						entry.render()
						group.sort()
					})

					const wrap = html`<span class="btr-select"></span>`
					wrap.append(select)
					slot.replaceChildren(wrap)
					modal.upgradeSelect?.(select)
				} else {
					const input = html<HTMLInputElement>`<input
						class="btr-exp-input"
						type="text"
						spellcheck="false"
						aria-label="${key}"
					/>`

					input.value = saved
					input.placeholder = currentJson || "Not set"

					const commit = () => {
						let valid = true

						if (input.value) {
							try {
								JSON.parse(input.value)
							} catch {
								valid = false
							}
						}

						input.classList.toggle("btr-exp-invalid", !valid)

						if (valid) {
							save(experiment, key, input.value)
							entry.edited = !!input.value
							row.classList.toggle("btr-exp-edited", entry.edited)
							group.sort()
						}
					}

					input.$on("keydown", (ev: KeyboardEvent) => ev.key === "Enter" && input.blur())
					input.$on("blur", commit)
					slot.replaceChildren(input)
				}
			},
		}

		group.entries[key] = entry
		entry.render()

		// A parameter that turns up after the scripts were read is looked up on
		// its own; the scripts themselves are cached by then.
		if (modal.experimentHints && !(key in modal.experimentHints)) {
			void discoverExperimentHints([key]).then((hints) => {
				Object.assign(modal.experimentHints!, hints)
				entry.render()
				group.sort()
			})
		}
	}

	const all: Record<string, Set<string>> = {}

	for (const source of [robloxExperiments, modal.getSavedExperiments()]) {
		for (const [experiment, values] of Object.entries(source) as [string, any][]) {
			for (const key of Object.keys(values ?? {})) {
				;(all[experiment] ??= new Set()).add(key)
			}
		}
	}

	for (const [experiment, keys] of Object.entries(all)) {
		const group = modal.experiments[experiment] ?? addGroup(experiment)

		for (const key of keys) {
			if (group.entries[key]) {
				group.entries[key].render()
			} else {
				addEntry(group, key)
			}
		}

		group.sort()
	}
}

/** Puts every experiment back to what Roblox sends. */
export const resetExperiments = (modal: SettingsModalState) => {
	for (const [experiment, values] of Object.entries(modal.getSavedExperiments()) as [string, any][]) {
		for (const key of Object.keys(values ?? {})) {
			injectScript.send("updateExperiment", experiment, key, "")
		}
	}

	SETTINGS.set("general.experiments", "")
	modal.robloxExperimentsChanged()
}
