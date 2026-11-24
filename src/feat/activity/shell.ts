import { html } from "@/core/html"
import { trapScroll } from "@/core/dom"

// The frame the activity dialogs share: a title, an action button, tabs with
// a panel each, and closing by button, Escape or a click outside. A dialog
// opened from another goes on top of it, and closing it goes back to the one
// below, on the tab and scroll position it was left at.

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

interface Open {
	root: HTMLElement
	close: () => void
}

/** The open dialogs, the one in front last. */
const stack: Open[] = []

// How long the open and close fades take, from the stylesheet.
const FADE = 120

export const openShell = (options: {
	title: string
	subtitle: string
	/** Makes the subtitle a link, to the profile or page it names. */
	subtitleHref?: string | undefined
	tabs: ReadonlyArray<readonly [string, string]>
	/** Called whenever a tab is shown, to fill its panel the first time. */
	onTab: (name: string, panel: HTMLElement) => void
}): Shell => {
	const below = stack.at(-1)
	const opener = document.activeElement as HTMLElement | null
	const root = html`<div class="btr-settings-modal btr-activity-modal">
		<div class="btr-activity" role="dialog" aria-modal="true" aria-labelledby="btr-activity-title">
			<header class="btr-activity-header">
				<div>
					<h2 id="btr-activity-title" class="btr-activity-title">${options.title}</h2>
					<div class="btr-activity-subtitle"></div>
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

	trapScroll(root, { covers: true })

	const subtitle = root.$req(".btr-activity-subtitle")
	if (options.subtitleHref) {
		const link = html`<a class="btr-activity-subtitle-link" href="${options.subtitleHref}">
			<span></span>
			<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
				<path
					d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</a>`
		link.$req("span").textContent = options.subtitle
		subtitle.append(link)
	} else {
		subtitle.textContent = options.subtitle
	}

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
		if (stack.at(-1)?.root !== root) {
			return
		}

		stack.pop()

		for (const fn of closers) {
			fn()
		}

		// The one below comes back as it was left, under this one fading out.
		if (below) {
			below.root.style.display = ""
		}

		root.classList.remove("btr-settings-open")
		document.removeEventListener("keydown", onKey, true)
		setTimeout(() => root.remove(), 320)
		opener?.focus()
	}

	const onKey = (ev: KeyboardEvent) => {
		// Only the dialog in front answers.
		if (ev.key === "Escape" && stack.at(-1)?.root === root) {
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

	stack.push({ root, close })
	document.body.append(root)
	root.$req<HTMLElement>(".btr-activity-close").focus()

	// A later frame than the mount, or there is no start to transition from.
	requestAnimationFrame(() => root.classList.add("btr-settings-open"))

	// The one below stays in the page to come back to, hidden once this one
	// covers it, as its backdrop would still catch clicks.
	if (below) {
		setTimeout(() => {
			if (stack.at(-1)?.root === root) {
				below.root.style.display = "none"
			}
		}, FADE)
	}

	return {
		root,
		tabs,
		panels,
		action: root.$req<HTMLButtonElement>(".btr-activity-watch"),
		selectTab,
		onClose: (fn) => closers.push(fn),
	}
}
