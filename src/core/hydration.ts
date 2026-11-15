// Roblox is moving pages to a new shell that it renders on the server and then
// hands to react, which takes over the HTML it finds (hydration). If anything
// in that HTML changed first, react throws all of it away and renders the page
// again, and everything the extension added goes with it. So on such a page,
// changes to it wait until react has it. The page script says when, by marking
// the root element.
//
// The old shell renders in the browser, and its body is marked rbx-body from
// the server, so pages that never hydrate are known as soon as there is a body.

const HYDRATED = "data-btr-hydrated"

/** How long to wait for word from the page before going ahead anyway. */
const GIVE_UP = 5000

let released = false
let started = false
const waiting: Array<() => void> = []

const release = () => {
	if (released) {
		return
	}

	released = true

	for (const callback of waiting.splice(0)) {
		try {
			callback()
		} catch (err) {
			console.error("[btr] hydration callback failed", err)
		}
	}
}

/** Whether this is a page in the new shell, rendered on the server. */
export const isNewShell = (): boolean => {
	const body = document.body
	return (
		!!body &&
		!body.classList.contains("rbx-body") &&
		(body.classList.contains("nav-slots") || !!document.querySelector("main > #header"))
	)
}

/** Settles it where it can be: marked by the page, or not a page that hydrates. */
const settled = (): boolean => {
	if (released) {
		return true
	}

	const body = document.body

	if (document.documentElement.hasAttribute(HYDRATED) || body?.classList.contains("rbx-body")) {
		release()
	}

	return released
}

const startWaiting = () => {
	if (started) {
		return
	}

	started = true
	setTimeout(release, GIVE_UP)

	new MutationObserver((_, observer) => {
		if (settled()) {
			observer.disconnect()
		}
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: [HYDRATED],
		childList: true,
	})

	// Pages that are neither, like Roblox's other sites, do not wait at all.
	const notNewShell = () => {
		if (!isNewShell()) {
			release()
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", notNewShell, { once: true })
	} else {
		notNewShell()
	}
}

/** Whether changes to this element have to wait for react to take the page over. */
export const mustWait = (element: Element): boolean => {
	if (settled()) {
		return false
	}

	const body = document.body

	// The head, and the body and root themselves, are not part of what react
	// checks: only their attributes change, and those it lets be.
	if (!body || element === body || !body.contains(element) || !isNewShell()) {
		return false
	}

	startWaiting()
	return true
}

/** Calls back once react has the page, or at once where it never will. */
export const whenHydrated = (callback: () => void): void => {
	if (settled()) {
		callback()
		return
	}

	waiting.push(callback)
	startWaiting()
}
