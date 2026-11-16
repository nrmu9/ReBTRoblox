import { html } from "@/core/html"
import { leave } from "@/core/leave"
import { injectScript } from "@/core/messaging"
import { RobloxApi } from "@/rbx/RobloxApi"

// The Adjust panel in the avatar editor: moves, turns and sizes the worn hats
// and other accessories within the limits Roblox sets, as its app does. The
// page script saves each change through the editor itself.

interface Vector {
	X: number
	Y: number
	Z: number
}

interface Meta {
	position: Vector
	rotation: Vector
	scale: Vector
	version: number
}

interface Worn {
	id: number
	name: string
	assetTypeId: number
	assetTypeName: string
	meta: Meta | null
}

type Bounds = Record<"position" | "rotation" | "scale", Record<"X" | "Y" | "Z", { min: number; max: number }>>

const DEFAULT_META = (): Meta => ({
	position: { X: 0, Y: 0, Z: 0 },
	rotation: { X: 0, Y: 0, Z: 0 },
	scale: { X: 1, Y: 1, Z: 1 },
	version: 1,
})

/** avatar-rules gives the limits per type name without spaces, as xPosition and so on. */
const readBounds = (rules: any): Record<string, Bounds> => {
	const out: Record<string, Bounds> = {}
	const lower = rules?.accessoryRefinementLowerBounds ?? {}
	const upper = rules?.accessoryRefinementUpperBounds ?? {}

	for (const [typeName, groups] of Object.entries(lower) as [string, any][]) {
		const bounds: any = {}

		for (const [group, values] of Object.entries(groups ?? {}) as [string, any][]) {
			bounds[group] = {}

			for (const [key, min] of Object.entries(values ?? {}) as [string, any][]) {
				bounds[group][key.slice(0, 1).toUpperCase()] = {
					min,
					max: upper[typeName]?.[group]?.[key] ?? min,
				}
			}
		}

		out[typeName] = bounds
	}

	return out
}

const round = (value: number, step: number) => Math.round(value / step) * step

let panel: HTMLElement | null = null

// Kept outside the panel, which redraws when the editor sends the saved list.
const statuses = new Map<number, { text: string; failed?: boolean }>()

const setStatus = (assetId: number, text: string, failed = false) => {
	statuses.set(assetId, { text, failed })
	const status = panel?.querySelector(`.btr-adjust-item[data-id="${assetId}"] .btr-adjust-status`)

	if (status) {
		status.textContent = text
		status.classList.toggle("btr-adjust-failed", failed)
	}
}
let rulesPromise: Promise<Record<string, Bounds>> | null = null
const getBounds = () => (rulesPromise ??= RobloxApi.avatar.getAvatarRules().then(readBounds))

const SLIDERS = [
	{ group: "position", label: "Position", step: 0.01, axes: ["X", "Y", "Z"] },
	{ group: "rotation", label: "Rotation", step: 1, axes: ["X", "Y", "Z"] },
	{ group: "scale", label: "Size", step: 0.01, axes: ["X"] },
] as const

const render = async (list: Worn[]) => {
	if (!panel) {
		return
	}

	const bounds = await getBounds()
	const body = panel.$req(".btr-adjust-body")
	const open = new Set(
		[...body.querySelectorAll<HTMLElement>(".btr-adjust-item[open]")].map((x) => x.dataset.id),
	)
	const focused = (document.activeElement as HTMLElement | null)?.dataset?.key

	body.replaceChildren()

	if (!list.length) {
		body.append(html`<p class="btr-adjust-empty">Wear a hat or another accessory to adjust it here.</p>`)
		return
	}

	for (const [index, asset] of list.entries()) {
		const limits = bounds[asset.assetTypeName.replace(/\s/g, "")]
		const meta = asset.meta ? structuredClone(asset.meta) : DEFAULT_META()
		const item = html<HTMLDetailsElement>`<details class="btr-adjust-item">
			<summary>
				<span class="btr-adjust-name">${asset.name}</span
				><span class="btr-adjust-type"
					>${asset.assetTypeName.replace(/([a-z])([A-Z])/g, "$1 $2")}</span
				><span class="btr-adjust-chevron" aria-hidden="true"></span>
			</summary>
			<div class="btr-adjust-controls"></div>
			<div class="btr-adjust-foot">
				<span class="btr-adjust-status" aria-live="polite"></span>
				<button type="button" class="btr-adjust-reset">Reset</button>
			</div>
		</details>`

		item.dataset.id = String(asset.id)
		item.open = open.size ? open.has(String(asset.id)) : index === 0

		const controls = item.$req(".btr-adjust-controls")
		const status = item.$req(".btr-adjust-status")

		if (!limits) {
			controls.append(html`<p class="btr-adjust-empty">Roblox gives no limits for this type.</p>`)
		}

		const known = statuses.get(asset.id)
		status.textContent = known?.text ?? ""
		status.classList.toggle("btr-adjust-failed", !!known?.failed)

		const save = () => {
			setStatus(asset.id, "Saving…")
			injectScript.send("adjustAsset", asset.id, meta)
		}

		for (const slider of limits ? SLIDERS : []) {
			const group = html`<fieldset class="btr-adjust-group"><legend>${slider.label}</legend></fieldset>`

			for (const axis of slider.axes) {
				const range = limits[slider.group][axis]
				const key = `${asset.id}-${slider.group}-${axis}`
				const value = meta[slider.group][axis]
				const row = html`<label class="btr-adjust-row">
					<span class="btr-adjust-axis">${slider.group === "scale" ? "" : axis}</span>
					<input
						type="range"
						min="${range.min}"
						max="${range.max}"
						step="${slider.step}"
						value="${value}"
						aria-label="${slider.label}${slider.group === "scale" ? "" : ` ${axis}`} of ${asset.name}"
					/>
					<output></output>
				</label>`

				const input = row.$req<HTMLInputElement>("input")
				const output = row.$req("output")
				input.dataset.key = key

				const show = () => {
					const number = Number(input.value)
					output.textContent =
						slider.group === "rotation"
							? `${Math.round(number)}°`
							: slider.group === "scale"
								? `${Math.round(number * 100)}%`
								: number.toFixed(2)
				}

				input.$on("input", show)
				input.$on("change", () => {
					const number = round(Number(input.value), slider.step)

					if (slider.group === "scale") {
						meta.scale = { X: number, Y: number, Z: number }
					} else {
						meta[slider.group][axis] = number
					}

					save()
				})

				show()
				group.append(row)

				if (focused === key) {
					queueMicrotask(() => input.focus())
				}
			}

			controls.append(group)
		}

		item.$req(".btr-adjust-reset").$on("click", () => {
			Object.assign(meta, DEFAULT_META())
			save()
		})

		body.append(item)
	}
}

let lastList: Worn[] = []

const openPanel = (list: Worn[]) => {
	lastList = list

	if (!panel) {
		panel = html`<div class="btr-adjust" role="dialog" aria-labelledby="btr-adjust-title">
			<div class="btr-adjust-head">
				<strong id="btr-adjust-title">Adjust accessories</strong>
				<button type="button" class="btr-adjust-close" aria-label="Close">✕</button>
			</div>
			<div class="btr-adjust-body"></div>
		</div>`

		const close = () => {
			leave(panel)
			panel = null
			document.removeEventListener("keydown", onKey)
		}

		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") {
				close()
			}
		}

		panel.$req(".btr-adjust-close").$on("click", close)
		document.addEventListener("keydown", onKey)
		document.body.append(panel)
	}

	void render(list)
}

export const initAdjustAccessories = () => {
	injectScript.listen("adjustOpen", (list: Worn[]) => openPanel(Array.isArray(list) ? list : []))

	// Worn items changed in the editor while the panel is open.
	injectScript.listen("adjustWorn", (list: Worn[]) => {
		lastList = Array.isArray(list) ? list : []

		if (panel && !panel.querySelector("input:active")) {
			void render(lastList)
		}
	})

	injectScript.listen("adjustResult", (assetId: number, ok: boolean) => {
		setStatus(assetId, ok ? "Saved" : "Roblox didn't take that change", !ok)

		if (!ok) {
			void render(lastList)
		}
	})
}
