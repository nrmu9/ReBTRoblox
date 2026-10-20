import { html } from "@/core/html"

// The frame the activity dialogs share: a title, an action button, tabs with
// a panel each, and closing by button, Escape or a click outside. One is open
// at a time.

export interface Shell {
	root: HTMLElement
	tabs: HTMLElement
	/** The panel for each tab, by name. */
	panels: Record<string, HTMLElement>
	/** A button beside the close button, hidden until used. */
	action: HTMLButtonElement
	selectTab: (name: string) => void
	/** Runs once the dialog closes. */
	onClose: (fn: () => void) => void
}

let open: { root: HTMLElement; close: () => void } | null = null

export const openShell = (options: {
	title: string
	subtitle: string
	tabs: ReadonlyArray<readonly [string, string]>
	/** Called whenever a tab is shown, to fill its panel the first time. */
	onTab: (name: string, panel: HTMLElement) => void
}): Shell => {
	open?.close()

	const opener = document.activeElement as HTMLElement | null
	const root = html`<div class="btr-settings-modal btr-activity-modal">
		<div class="btr-activity" role="dialog" aria-modal="true" aria-labelledby="btr-activity-title">
			<header class="btr-activity-header">
				<div>
					<h2 id="btr-activity-title" class="btr-activity-title">${options.title}</h2>
					<div class="btr-activity-subtitle">${options.subtitle}</div>
				</div>
				<button type="button" class="btr-activity-watch" aria-pressed="false" hidden></button>
				<button
					type="button"
					class="btr-settings-icon-button btr-activity-close"
					aria-label="Close"
					title="Close"
				>
					<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
						<path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>
			<div class="btr-activity-tabs" role="tablist"></div>
			<div class="btr-activity-body"></div>
		</div>
	</div>`

	// Matches the page's theme, as the settings panel does.
	root.classList.toggle("btr-dark-theme", !!document.querySelector(".dark-theme:not(.btr-settings-modal)"))

	const tabs = root.$req(".btr-activity-tabs")
	const body = root.$req(".btr-activity-body")
	const panels: Record<string, HTMLElement> = {}

	for (const [name, label] of options.tabs) {
		const button = html`<button type="button" role="tab" data-tab="${name}">${label}</button>`
		button.$on("click", () => selectTab(name))
		tabs.append(button)

		panels[name] = html`<div class="btr-activity-panel" data-tab="${name}" role="tabpanel"></div>`
		body.append(panels[name])
	}

	const selectTab = (name: string) => {
		for (const button of tabs.$findAll<HTMLElement>("[data-tab]")) {
			const selected = button.dataset.tab === name
			button.setAttribute("aria-selected", String(selected))
			button.tabIndex = selected ? 0 : -1
		}

		for (const [panelName, panel] of Object.entries(panels)) {
			panel.hidden = panelName !== name
		}

		options.onTab(name, panels[name])
	}

	const closers: Array<() => void> = []

	const close = () => {
		if (open?.root !== root) {
			return
		}

		open = null

		for (const fn of closers) {
			fn()
		}

		root.classList.remove("btr-settings-open")
		document.removeEventListener("keydown", onKey, true)
		setTimeout(() => root.remove(), 320)
		opener?.focus()
	}

	const onKey = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") {
			ev.stopPropagation()
			close()
		}
	}

	document.addEventListener("keydown", onKey, true)
	root.$req(".btr-activity-close").$on("click", close)
	root.$on("click", (ev: MouseEvent) => {
		if (ev.target === root) {
			close()
		}
	})

	open = { root, close }
	document.body.append(root)
	root.$req<HTMLElement>(".btr-activity-close").focus()

	// A later frame than the mount, or there is no start to transition from.
	requestAnimationFrame(() => root.classList.add("btr-settings-open"))

	return {
		root,
		tabs,
		panels,
		action: root.$req<HTMLButtonElement>(".btr-activity-watch"),
		selectTab,
		onClose: (fn) => closers.push(fn),
	}
}
