import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The rows and controls the settings pages are built from, and what their buttons do.

/** Runs `action` on a second click within three seconds, the first one counting down. */
export const confirmClick = (button: HTMLButtonElement, action: () => void) => {
	const label = button.textContent ?? ""
	let timer: ReturnType<typeof setInterval> | null = null
	let left = 0

	const stop = () => {
		if (timer !== null) {
			clearInterval(timer)
		}
		timer = null
		button.textContent = label
		button.classList.remove("btr-settings-button-armed")
	}

	button.$on("click", () => {
		if (timer === null) {
			left = 3
			button.textContent = `Confirm (${left})`
			button.classList.add("btr-settings-button-armed")

			timer = setInterval(() => {
				if (--left > 0) {
					button.textContent = `Confirm (${left})`
				} else {
					stop()
				}
			}, 1e3)
			return
		}

		stop()
		action()
	})
}

export const joinPaths = (group: string, path: string) =>
	!group || path.includes(".") ? path : `${group}.${path}`

/** A setting's dependency, as a getter, or null when there is none. */
const requirement = (groupPath: string, attr: string | null) => {
	const requireAttr = attr ?? "enabled"

	if (requireAttr === "true" || requireAttr === "false") {
		return null
	}

	const path = joinPaths(groupPath, requireAttr.replace(/^!/, ""))

	if (!SETTINGS.hasSetting(path)) {
		return null
	}

	const invert = requireAttr.startsWith("!")
	return { path, get: () => !!SETTINGS.get(path) !== invert }
}

export const makeRow = (labelText: string, descText: string | null, id?: string) => {
	const row = html`<div class="btr-setting-row">
		<label class="btr-setting-text">
			<span class="btr-setting-label">${labelText}</span>
		</label>
	</div>`

	if (id) {
		row.$req("label").setAttribute("for", id)
	}

	if (descText) {
		row.$req(".btr-setting-text").append(html`<span class="btr-setting-desc">${descText}</span>`)
	}

	return row
}

export const makeSwitch = (id: string) => {
	const wrap = html`<span class="btr-setting-switch">
		<input type="checkbox" role="switch" />
		<span class="btr-setting-switch-track" aria-hidden="true"
			><span class="btr-setting-switch-knob"></span
		></span>
	</span>`

	const input = wrap.$req<HTMLInputElement>("input")
	input.id = id

	return { wrap, input }
}

export const makeReset = (path: string) =>
	html<HTMLButtonElement>`<button type="button" class="btr-setting-reset" path=${path}>Reset</button>`

/** Disables a row while what it depends on is off. */
const followRequirement = (row: HTMLElement, control: HTMLElement, req: ReturnType<typeof requirement>) => {
	if (!req) {
		return
	}

	const update = () => {
		const on = req.get()
		row.classList.toggle("btr-setting-disabled", !on)
		control.toggleAttribute("disabled", !on)
	}

	SETTINGS.onChange(req.path, update)
	update()
}

export const createRows = () => {
	let inputCounter = 0
	const nextId = () => `btr-settings-input-${inputCounter++}`

	const settingsDone: Record<string, boolean> = {}

	const buildToggle = (elem: HTMLElement, groupPath: string, pageToggle: string | null) => {
		const attr = elem.getAttribute("path")!
		const path = joinPaths(groupPath, attr.replace(/^!/, ""))
		const invert = attr.startsWith("!")
		settingsDone[path] = true

		const id = nextId()
		const row = makeRow(elem.getAttribute("label") ?? path, elem.getAttribute("desc"), id)
		const { wrap, input } = makeSwitch(id)

		if (!SETTINGS.hasSetting(path)) {
			row.$req(".btr-setting-label").textContent += " (bad setting)"
			input.disabled = true
			row.append(wrap)
			return row
		}

		row.dataset.path = path
		row.append(makeReset(path), wrap)

		// A mode is the live half of a feature that otherwise needs a reload,
		// so the one switch sets both and reads as on only when both are.
		const mode = elem.getAttribute("mode")

		if (mode) {
			settingsDone[mode] = true
		}

		input.$on("change", () => {
			SETTINGS.set(path, input.checked !== invert)

			if (mode) {
				SETTINGS.set(mode, input.checked ? "always" : "never")
			}
		})

		const update = () => {
			input.checked = !!SETTINGS.get(path) !== invert && (!mode || SETTINGS.get(mode) !== "never")
		}

		SETTINGS.onChange(path, update)
		if (mode) {
			SETTINGS.onChange(mode, update)
		}
		update()

		const reqAttr = elem.getAttribute("require")
		const req = requirement(groupPath, reqAttr)

		// Indented under the setting it depends on, unless that is just the
		// page's own switch.
		if (req && req.path !== pageToggle) {
			row.classList.add("btr-setting-child")
		}

		followRequirement(row, input, req)
		return row
	}

	const buildChoice = (elem: HTMLElement, groupPath: string, pageToggle: string | null) => {
		const path = joinPaths(groupPath, elem.getAttribute("path")!)
		settingsDone[path] = true

		const id = nextId()
		const row = makeRow(elem.getAttribute("label") ?? path, elem.getAttribute("desc"), id)
		const select = html<HTMLSelectElement>`<select></select>`
		select.id = id
		select.append(...elem.querySelectorAll("option"))

		const wrap = html`<span class="btr-select"></span>`
		wrap.append(select)

		row.dataset.path = path
		row.append(makeReset(path), wrap)

		select.$on("change", () => SETTINGS.set(path, select.value))

		const update = () => {
			select.value = SETTINGS.get(path)
		}

		SETTINGS.onChange(path, update)
		update()

		const req = requirement(groupPath, elem.getAttribute("require"))

		if (req && req.path !== pageToggle) {
			row.classList.add("btr-setting-child")
		}

		followRequirement(row, select, req)
		return row
	}

	return { nextId, settingsDone, buildToggle, buildChoice }
}

export type Rows = ReturnType<typeof createRows>

// Reset links show only once a setting differs from its default.
export const bindResetButtons = (modal: SettingsModalState) => {
	for (const btn of modal.settingsDiv.$findAll(
		".btr-setting-reset[path]",
	) as NodeListOf<HTMLButtonElement>) {
		const path = btn.getAttribute("path")!
		btn.title = "Reset to default"

		const update = () => {
			btn.classList.toggle("btr-setting-reset-shown", !SETTINGS.getIsDefault(path))
		}

		btn.$on("click", (ev: Event) => {
			ev.preventDefault()
			SETTINGS.reset(path)
		})

		SETTINGS.onChange(path, update)
		update()
	}
}
