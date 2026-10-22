// The corner of Roblox pages where ReBTRoblox's notices stack, so one never
// covers another.

/** The stack, made the first time a notice needs it. */
export const toastArea = (): HTMLElement => {
	let area = document.querySelector<HTMLElement>(".btr-toasts")

	if (!area) {
		area = document.createElement("div")
		area.className = "btr-toasts"
		document.body.append(area)
	}

	return area
}
