// Content script entry.
//
// Content scripts cannot be ES modules, so this stays a small classic script. It
// performs the document_start checks synchronously, then pulls in the real
// bundle, which esbuild is free to code split. Loading the heavy optional
// features on demand is what keeps three.js out of the initial download.

if (
	document.contentType === "text/html" &&
	location.protocol !== "blob" &&
	document.readyState === "loading" &&
	!document.documentElement.getAttribute("btr-loaded")
) {
	document.documentElement.setAttribute("btr-loaded", "true")

	// The profile shows the inventory page in a sandboxed frame, which that
	// page's frame buster (an inline top.location = self.location.href) may not
	// navigate out of, so it threw and logged errors on every profile. It is
	// turned off before it runs, which has to start here, as main.js loads too
	// late: the parser hands a script to observers before running it.
	let frame: Element | null = null
	try {
		frame = window.frameElement
	} catch {}

	if (frame?.id === "btr-injected-inventory") {
		const disarm = (node: Node) => {
			const script = node instanceof Text ? node.parentElement : node

			if (
				script instanceof HTMLScriptElement &&
				!script.src &&
				script.textContent?.includes("top.location")
			) {
				script.type = "text/plain"
				return true
			}

			return false
		}

		const observer = new MutationObserver((records) => {
			for (let i = 0; i < records.length; i++) {
				const added = records[i].addedNodes

				for (let j = 0; j < added.length; j++) {
					if (disarm(added[j])) {
						observer.disconnect()
						return
					}
				}
			}
		})

		observer.observe(document, { childList: true, subtree: true })
		document.addEventListener("DOMContentLoaded", () => observer.disconnect(), { once: true })
	}

	void import(chrome.runtime.getURL("js/main.js")).catch((err) =>
		console.error("[btr] failed to load main bundle", err),
	)
}
