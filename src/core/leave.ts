// Closing panels, cards and menus: a short fade out, the reverse of how they
// came in, before they are taken off the page.

/** Plays the closing animation on `element`, then removes it. */
export const leave = (element: Element | null | undefined): void => {
	if (!element?.isConnected || element.classList.contains("btr-leaving")) {
		return
	}

	if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
		element.remove()
		return
	}

	element.classList.add("btr-leaving")
	element.addEventListener("animationend", () => element.remove(), { once: true })
	// A hidden tab never runs the animation, so a timer backs it up.
	setTimeout(() => element.remove(), 400)
}
